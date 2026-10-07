import { record } from "../audit.js";
import { assertVillageAccess } from "../auth.js";
import { badRequest, clean, conflict, forbidden, indexBy, isLocationFresh, isOnline, isUuid, notFound, nowIso, oneOf, optionalText } from "../lib.js";
import { publish } from "../realtime.js";
import { accessProfile, estimateAlternativeRoute, estimateRoute, hazardRiskAt, isValidPoint } from "../geo.js";
import { activeRuleSet, ageFrom, assessmentFactors, isNightNow, LEVEL_LABEL, mergeFactors, profileFactors, recommend, type FactorInput } from "../recommend.js";
import { param, type Ctx } from "../router.js";
import type { Query, Store } from "../store.js";
import type { RecommendationLevel, Row } from "../types.js";
import { releaseVillageAlarms } from "./alerts-api.js";
import { getSettings } from "./platform-api.js";
import { eqFilter, scopedQuery } from "./common.js";

/**
 * Operasi = jendela akses data warga untuk JAGA Rescue.
 *
 * - Dibuka JAGA Desa saat alarm seluruh desa tingkat SIAGA atau AWAS dibunyikan.
 * - Selama ACTIVE, Rescue melihat roster PEMAKAI KALUNG di area operasi; di luar itu Rescue tidak melihat data warga.
 * - Ditutup oleh Desa/Pusat; akses Rescue otomatis berhenti. Setiap pembukaan roster/profil oleh Rescue dicatat di audit.
 * - Area operasi = seluruh desa. Desa menilai dan memperbarui area serta
 *   tinggi air berdasarkan pengamatan lapangan.
 */

export const AUTO_OPEN_SEVERITIES = ["SIAGA", "AWAS"];
const SEVERITIES = ["WASPADA", "SIAGA", "AWAS"] as const;
const SEVERITY_RANK: Record<string, number> = { WASPADA: 0, SIAGA: 1, AWAS: 2 };
const CLOSED_INCIDENT = new Set(["SAFE", "CANCELLED", "CLOSED"]);
const LEVEL_RANK: Record<string, number> = { DARURAT: 0, RESPONS_CEPAT: 1, SEGERA_TINJAU: 2, PANTAU: 3 };
const CHUNK = 80;

/** `in` dengan banyak id dipecah agar URL PostgREST tidak melewati batas panjang. */
async function listIn(store: Store, table: string, column: string, ids: string[], extra: Query = {}): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    out.push(...await store.list(table, { ...extra, in: { ...(extra.in ?? {}), [column]: ids.slice(i, i + CHUNK) } }));
  }
  return out;
}

export const parseWaterLevel = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2000) throw badRequest("Tinggi air harus berupa angka 0 sampai 2000 cm");
  return Math.round(parsed);
};

/* ------------------------------------------------------------ Pemakai kalung */

/** Warga aktif pemakai kalung (perangkat terpasang) di area operasi. `only` = daftar kandidat yang sudah dipastikan areanya. */
async function holders(store: Store, operation: Row, only?: Row[]): Promise<Array<{ resident: Row; assignment: Row }>> {
  const residents = only ?? await store.list("residents", { eq: { village_id: String(operation.village_id), active: true } });
  const pool = residents.filter(row => row.active !== false);
  if (!pool.length) return [];
  const assignments = await listIn(store, "device_assignments", "resident_id", pool.map(row => String(row.id)), { isNull: { unassigned_at: true } });
  const byResident = new Map(assignments.map(row => [String(row.resident_id), row]));
  return pool
    .filter(row => byResident.has(String(row.id)))
    .map(resident => ({ resident, assignment: byResident.get(String(resident.id)) as Row }));
}

const ageGroupOf = (birthDate: unknown): string | null => {
  const age = ageFrom(birthDate);
  return age === null ? null : age < 5 ? "BAYI" : age < 12 ? "ANAK" : age >= 65 ? "LANSIA" : "DEWASA";
};

/** Warna prioritas penyelamatan (merah paling mendesak). */
const PRIORITY_COLOR: Record<RecommendationLevel, { color: string; colorLabel: string }> = {
  DARURAT: { color: "red", colorLabel: "Merah" },
  RESPONS_CEPAT: { color: "orange", colorLabel: "Oranye" },
  SEGERA_TINJAU: { color: "yellow", colorLabel: "Kuning" },
  PANTAU: { color: "green", colorLabel: "Hijau" }
};

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Roster untuk Rescue. Hanya data yang dibutuhkan di lapangan: tanpa NIK, tanggal lahir persis, jenis kelamin,
 * dan tanpa data warga yang tidak memakai kalung.
 *
 * Setiap pemakai kalung mendapat prioritas berwarna dari aturan prioritas AKTIF (bobot disahkan Pusat), dihitung dari
 * profil, lokasi terhadap zona bahaya, kondisi kalung, SOS/penilaian lapangan, dan pengamatan Desa. Alasan ditampilkan.
 */
export async function buildRoster(store: Store, operation: Row, only?: Row[]): Promise<Row[]> {
  const found = await holders(store, operation, only);
  // Kebijakan JAGA Pusat (tata kelola data): bagian mana dari profil yang boleh dilihat Rescue.
  const policy = await getSettings(store);
  if (!found.length) return [];
  const villageId = String(operation.village_id);
  const residentIds = found.map(item => String(item.resident.id));
  const deviceIds = found.map(item => String(item.assignment.device_id));

  const [vulns, contacts, devices, incidents, types, zones, village] = await Promise.all([
    listIn(store, "resident_vulnerabilities", "resident_id", residentIds),
    listIn(store, "resident_contacts", "resident_id", residentIds),
    listIn(store, "devices", "id", deviceIds),
    listIn(store, "incidents", "resident_id", residentIds),
    store.list("vulnerability_types", {}),
    store.list("hazard_zones", { eq: { village_id: villageId } }),
    store.one("villages", { eq: { id: villageId } })
  ]);
  const openIncidents = incidents.filter(row => !CLOSED_INCIDENT.has(String(row.status)));
  const openIds = openIncidents.map(row => String(row.id));
  const [recommendations, assessments] = openIds.length
    ? await Promise.all([
        listIn(store, "priority_recommendations", "incident_id", openIds, { isNull: { superseded_at: true } }),
        listIn(store, "incident_assessments", "incident_id", openIds)
      ])
    : [[] as Row[], [] as Row[]];
  const [overrides, assessmentFactorRows] = await Promise.all([
    recommendations.length ? listIn(store, "priority_overrides", "recommendation_id", recommendations.map(row => String(row.id))) : [],
    assessments.length ? listIn(store, "assessment_factors", "assessment_id", assessments.map(row => String(row.id))) : []
  ]);

  let rules: Awaited<ReturnType<typeof activeRuleSet>> | null = null;
  try { rules = await activeRuleSet(store, String(operation.disaster_type)); } catch { rules = null; }

  const typeMap = indexBy(types, row => String(row.id));
  const deviceMap = indexBy(devices, row => String(row.id));
  const accessDifficulty = accessProfile(village?.access_notes).difficulty;
  const water = num(operation.water_level_cm);
  const operationFactors: FactorInput[] = water === null ? [] : [{
    key: "operation_water_level_cm", value: water, source: "INCIDENT", note: "Pengamatan JAGA Desa pada operasi aktif"
  }];
  const night = isNightNow();

  const items = found.map(({ resident, assignment }) => {
    const id = String(resident.id);
    const device = deviceMap.get(String(assignment.device_id)) ?? null;
    const residentVulns: Row[] = vulns
      .filter(row => String(row.resident_id) === id)
      .map(row => ({ ...row, type: typeMap.get(String(row.vulnerability_type_id)) ?? null }));
    const residentContacts = contacts.filter(row => String(row.resident_id) === id);
    const incident = openIncidents
      .filter(row => String(row.resident_id) === id)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null;
    const recommendation = incident ? recommendations.find(row => String(row.incident_id) === String(incident.id)) ?? null : null;
    const override = recommendation
      ? overrides.filter(row => String(row.recommendation_id) === String(recommendation.id))
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null
      : null;

    // Posisi terbaik: GPS kalung bila segar (warga mungkin tidak sedang di rumah), selain itu lokasi rumah.
    const homeLat = num(resident.latitude), homeLng = num(resident.longitude);
    const liveLat = num(device?.latitude), liveLng = num(device?.longitude);
    const live = policy.rescue_view_gps && Boolean(device) && isLocationFresh(device) && liveLat !== null && liveLng !== null;
    const where = live
      ? { latitude: liveLat as number, longitude: liveLng as number }
      : homeLat !== null && homeLng !== null ? { latitude: homeLat, longitude: homeLng } : null;

    let priority: Row | null = null;
    if (rules) {
      const position = where;
      const incidentAssessments = incident
        ? assessments
            .filter(row => String(row.incident_id) === String(incident.id))
            .map(row => ({ ...row, factors: assessmentFactorRows.filter(factor => String(factor.assessment_id) === String(row.id)) }))
        : [];
      const factors = mergeFactors(
        profileFactors(resident, residentVulns, residentContacts),
        [{ key: "terrain_isolation", value: accessDifficulty, source: "PROFILE" }],
        [
          { key: "hazard_zone_risk", value: position && isValidPoint(position) ? hazardRiskAt(position, zones) : null, source: "SYSTEM" },
          { key: "has_active_sos", value: Boolean(incident), source: "INCIDENT" },
          { key: "is_night", value: night, source: "SYSTEM" },
          { key: "device_battery", value: num(device?.battery), source: "DEVICE" },
          { key: "device_online", value: isOnline(device), source: "DEVICE" }
        ],
        incident ? [{ key: "severity_reported", value: String(incident.severity ?? ""), source: "INCIDENT" }] : [],
        operationFactors,
        assessmentFactors(incidentAssessments)
      );
      const result = recommend({ ruleSet: rules.ruleSet, rules: rules.rules, bands: rules.bands, factors });
      // Petugas dapat mengubah level dengan alasan (tercatat); level hasil aturan tetap disimpan sebagai systemLevel.
      const level = (override ? String(override.selected_level) : result.systemLevel) as RecommendationLevel;
      priority = {
        level,
        label: LEVEL_LABEL[level],
        ...PRIORITY_COLOR[level],
        score: result.score,
        systemLevel: result.systemLevel,
        overridden: Boolean(override),
        overrideReason: override?.reason ?? null,
        reasons: result.reasons,
        ruleSet: { name: rules.ruleSet.name, version: rules.ruleSet.version }
      };
    }

    return {
      residentId: id,
      fullName: resident.full_name,
      ageGroup: ageGroupOf(resident.birth_date),
      phone: policy.rescue_view_contacts ? resident.phone ?? null : null,
      address: resident.address ?? null,
      latitude: where?.latitude ?? null,
      longitude: where?.longitude ?? null,
      positionSource: live ? "GPS" : "RUMAH",
      positionAt: live ? device?.location_at ?? null : null,
      positionAccuracyMeters: live ? device?.location_accuracy_m ?? null : null,
      homeLatitude: resident.latitude ?? null,
      homeLongitude: resident.longitude ?? null,
      livesAlone: resident.lives_alone === true,
      evacuationAbility: resident.evacuation_ability ?? null,
      timeCriticalMedical: resident.time_critical_medical === true,
      mobilityNotes: resident.mobility_notes ?? null,
      communicationNotes: resident.communication_notes ?? null,
      medicalNotes: policy.rescue_view_medical ? resident.medical_notes ?? null : null,
      evacuationNotes: resident.evacuation_notes ?? null,
      vulnerabilities: residentVulns.map(row => ({
        name: row.type?.name ?? null, category: row.type?.category ?? null, severity: row.severity ?? null, assistanceNotes: row.assistance_notes ?? null
      })),
      contacts: (policy.rescue_view_contacts ? residentContacts : []).map(row => ({
        name: row.name, relationship: row.relationship ?? null, phone: row.phone, isPrimary: row.is_primary === true, livesWithResident: row.lives_with_resident === true
      })),
      device: device ? {
        id: device.id, battery: device.battery ?? null, online: isOnline(device), lastSeenAt: device.last_seen_at ?? null,
        latitude: policy.rescue_view_gps ? device.latitude ?? null : null, longitude: policy.rescue_view_gps ? device.longitude ?? null : null, locationAt: policy.rescue_view_gps ? device.location_at ?? null : null
      } : null,
      activeIncident: incident ? { id: incident.id, status: incident.status, severity: incident.severity ?? null, createdAt: incident.created_at } : null,
      priority
    };
  });

  // Urutan: level (merah dulu), lalu skor tertinggi, lalu nama agar mudah ditelusuri berurutan di lapangan.
  return items.sort((a, b) => {
    const levelA = a.priority ? LEVEL_RANK[String(a.priority.level)] ?? 9 : 9;
    const levelB = b.priority ? LEVEL_RANK[String(b.priority.level)] ?? 9 : 9;
    if (levelA !== levelB) return levelA - levelB;
    const scoreA = Number(a.priority?.score ?? 0), scoreB = Number(b.priority?.score ?? 0);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return String(a.fullName).localeCompare(String(b.fullName), "id");
  });
}

/** Operasi aktif yang mencakup warga ini dan warga tersebut memakai kalung; null bila tidak ada. */
export async function rescueOperationFor(store: Store, resident: Row): Promise<Row | null> {
  const operations = await store.list("operations", { eq: { village_id: String(resident.village_id), status: "ACTIVE" } });
  for (const operation of operations) {
    if ((await holders(store, operation, [resident])).length) return operation;
  }
  return null;
}

/** Id warga dan perangkat yang boleh tampil pada peta Rescue (pemakai kalung di operasi aktif dalam lingkupnya). */
export async function rescueVisible(ctx: Ctx): Promise<{ residentIds: Set<string>; deviceIds: Set<string> }> {
  const operations = await ctx.store.list("operations", scopedQuery(ctx.session, "village_id", { eq: { status: "ACTIVE" } }));
  const residentIds = new Set<string>();
  const deviceIds = new Set<string>();
  for (const operation of operations) {
    for (const { resident, assignment } of await holders(ctx.store, operation)) {
      residentIds.add(String(resident.id));
      deviceIds.add(String(assignment.device_id));
    }
  }
  return { residentIds, deviceIds };
}

/** Detail satu warga untuk Rescue: hanya pemakai kalung di area operasi aktif. */
export async function rescueResidentView(ctx: Ctx) {
  const resident = await ctx.store.one("residents", { eq: { id: param(ctx, "id") } });
  if (!resident) throw notFound("Warga tidak ditemukan");
  assertVillageAccess(ctx.session, resident.village_id);
  const operation = await rescueOperationFor(ctx.store, resident);
  if (!operation) {
    throw forbidden("Rescue hanya dapat membuka data pemakai kalung di area operasi yang sedang aktif");
  }
  const [item] = await buildRoster(ctx.store, operation, [resident]);
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "RESCUE_RESIDENT_VIEW", entityType: "operations",
    entityId: String(operation.id), summary: `Rescue membuka profil ${resident.full_name} (operasi aktif)`
  });
  return { restricted: true, operationId: operation.id, resident: item };
}

/* -------------------------------------------------------------------- Bentuk */

async function shapeOperations(store: Store, rows: Row[]) {
  const villageIds = Array.from(new Set(rows.map(row => String(row.village_id))));
  const villages = villageIds.length ? await listIn(store, "villages", "id", villageIds) : [];
  const villageMap = indexBy(villages, row => String(row.id));
  return rows.map(row => {
    return {
      id: row.id,
      villageId: row.village_id,
      villageName: villageMap.get(String(row.village_id))?.name ?? null,
      status: row.status,
      severity: row.severity,
      disasterType: row.disaster_type,
      areaLabel: "Seluruh desa",
      waterLevelCm: row.water_level_cm ?? null,
      note: row.note ?? null,
      alertCommandId: row.alert_command_id ?? null,
      openedBy: row.opened_by ?? null,
      openedAt: row.opened_at,
      closedAt: row.closed_at ?? null,
      closeNote: row.close_note ?? null
    };
  });
}

async function loadOperation(ctx: Ctx): Promise<Row> {
  const operation = await ctx.store.one("operations", { eq: { id: param(ctx, "id") } });
  if (!operation) throw notFound("Operasi tidak ditemukan");
  assertVillageAccess(ctx.session, operation.village_id);
  return operation;
}

/* ------------------------------------------------------------ Buka / eskalasi */

interface OpenInput {
  villageId: string;
  severity: string;
  commandId: string;
  waterLevelCm?: unknown;
  note?: unknown;
  disasterType?: unknown;
}

/** Membuka operasi bagi desa, atau meningkatkan operasi yang sudah aktif (area digabung, tingkat dinaikkan). */
export async function openOrEscalateOperation(ctx: Ctx, input: OpenInput): Promise<Row> {
  const waterLevel = parseWaterLevel(input.waterLevelCm);
  const note = optionalText(input.note, "Catatan pengamatan", 1000);

  const escalate = async (existing: Row): Promise<Row> => {
    const patch: Row = {
      severity: (SEVERITY_RANK[input.severity] ?? 0) > (SEVERITY_RANK[String(existing.severity)] ?? 0) ? input.severity : existing.severity,
    };
    if (waterLevel !== null) patch.water_level_cm = waterLevel;
    if (note) patch.note = note;
    const updated = await ctx.store.update("operations", String(existing.id), patch) ?? { ...existing, ...patch };
    await record(ctx.store, {
      actorId: ctx.session.profileId, action: "OPERATION_ESCALATE", entityType: "operations",
      entityId: String(existing.id), summary: `Operasi ditingkatkan: ${patch.severity}`, before: existing, after: updated
    });
    publish("operation.updated", { id: existing.id, severity: patch.severity, villageId: input.villageId }, input.villageId);
    return updated;
  };

  const existing = await ctx.store.one("operations", { eq: { village_id: input.villageId, status: "ACTIVE" } });
  if (existing) return escalate(existing);

  const disasterType = (optionalText(input.disasterType, "Jenis bencana", 80) ?? "BANJIR").toUpperCase();
  let created: Row;
  try {
    created = await ctx.store.insert("operations", {
      village_id: input.villageId,
      status: "ACTIVE",
      severity: input.severity,
      disaster_type: disasterType,
      area_type: "DESA",
      water_level_cm: waterLevel,
      note,
      alert_command_id: input.commandId,
      opened_by: isUuid(ctx.session.profileId) ? ctx.session.profileId : null,
      opened_at: nowIso()
    });
  } catch (error) {
    // Alarm bersamaan: operasi aktif sudah dibuat pihak lain, gabungkan saja.
    const race = await ctx.store.one("operations", { eq: { village_id: input.villageId, status: "ACTIVE" } });
    if (race) return escalate(race);
    throw error;
  }
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "OPERATION_OPEN", entityType: "operations",
    entityId: String(created.id), summary: `Operasi ${disasterType} dibuka (${input.severity})`, after: created
  });
  publish("operation.opened", { id: created.id, severity: input.severity, villageId: input.villageId, areaType: created.area_type }, input.villageId);
  return created;
}

/* ------------------------------------------------------------------- Handler */

export async function listOperations(ctx: Ctx) {
  const status = clean(ctx.query.get("status") ?? "ACTIVE").toUpperCase();
  const rows = await ctx.store.list("operations", scopedQuery(ctx.session, "village_id", {
    ...eqFilter(status === "ALL" ? null : { status: oneOf(status, ["ACTIVE", "CLOSED"] as const, "Status") }),
    order: { opened_at: "desc" },
    limit: 100
  }));
  return shapeOperations(ctx.store, rows);
}

export async function getOperation(ctx: Ctx) {
  const operation = await loadOperation(ctx);
  return (await shapeOperations(ctx.store, [operation]))[0];
}

/** Rescue hanya saat ACTIVE; Desa dan Pusat boleh melihat riwayat. */
async function rosterFor(ctx: Ctx, operation: Row): Promise<Row[]> {
  if (ctx.session.role === "RESCUE" && String(operation.status) !== "ACTIVE") {
    throw forbidden("Operasi sudah ditutup. Akses data warga untuk Rescue telah dicabut.");
  }
  const roster = await buildRoster(ctx.store, operation);
  if (ctx.session.role !== "DESA") {
    await record(ctx.store, {
      actorId: ctx.session.profileId, action: "OPERATION_ROSTER_VIEW", entityType: "operations",
      entityId: String(operation.id), summary: `${ctx.session.role} membuka roster operasi (${roster.length} pemakai kalung)`
    });
  }
  return roster;
}

export async function getRoster(ctx: Ctx) {
  const operation = await loadOperation(ctx);
  return rosterFor(ctx, operation);
}

/** Paket untuk dibawa ke lapangan tanpa koneksi: operasi, desa, roster, zona bahaya, dan shelter. */
export async function offlinePack(ctx: Ctx) {
  const operation = await loadOperation(ctx);
  const roster = await rosterFor(ctx, operation);
  const villageId = String(operation.village_id);
  const [village, zones, shelters] = await Promise.all([
    ctx.store.one("villages", { eq: { id: villageId } }),
    ctx.store.list("hazard_zones", { eq: { village_id: villageId } }),
    ctx.store.list("evacuation_shelters", { eq: { village_id: villageId } })
  ]);
  return {
    generatedAt: nowIso(),
    warning: "Berisi data pribadi warga rentan. Simpan hanya di perangkat petugas dan hapus setelah operasi selesai.",
    operation: (await shapeOperations(ctx.store, [operation]))[0],
    village: village ? { id: village.id, name: village.name, latitude: village.latitude ?? null, longitude: village.longitude ?? null, accessNotes: village.access_notes ?? null } : null,
    roster,
    hazardZones: zones.map(zone => ({
      id: zone.id, name: zone.name, hazardType: zone.hazard_type, riskLevel: zone.risk_level,
      centerLatitude: zone.center_latitude ?? null, centerLongitude: zone.center_longitude ?? null,
      radiusMeters: zone.radius_meters ?? null, accessNotes: zone.access_notes ?? null
    })),
    shelters: shelters.map(shelter => ({
      id: shelter.id, name: shelter.name, address: shelter.address ?? null,
      latitude: shelter.latitude ?? null, longitude: shelter.longitude ?? null, capacity: shelter.capacity ?? null
    }))
  };
}

/** Desa memperbarui area, tinggi air, catatan, atau tingkat selama operasi berjalan. */
export async function updateOperation(ctx: Ctx) {
  const operation = await loadOperation(ctx);
  if (String(operation.status) !== "ACTIVE") throw conflict("Operasi sudah ditutup");
  const patch: Row = {};
  if (ctx.body.waterLevelCm !== undefined) patch.water_level_cm = parseWaterLevel(ctx.body.waterLevelCm);
  if (ctx.body.note !== undefined) patch.note = optionalText(ctx.body.note, "Catatan pengamatan", 1000);
  if (ctx.body.severity !== undefined) patch.severity = oneOf(ctx.body.severity, SEVERITIES, "Tingkat kewaspadaan");
  if (!Object.keys(patch).length) throw badRequest("Tidak ada perubahan yang dikirim");
  const updated = await ctx.store.update("operations", String(operation.id), patch);
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "OPERATION_UPDATE", entityType: "operations",
    entityId: String(operation.id), summary: "Memperbarui operasi", before: operation, after: updated
  });
  publish("operation.updated", { id: operation.id, severity: updated?.severity ?? operation.severity, villageId: operation.village_id }, String(operation.village_id));
  return (await shapeOperations(ctx.store, [updated ?? { ...operation, ...patch }]))[0];
}

export async function closeOperation(ctx: Ctx) {
  const operation = await loadOperation(ctx);
  if (String(operation.status) !== "ACTIVE") throw conflict("Operasi sudah ditutup");
  const updated = await ctx.store.update("operations", String(operation.id), {
    status: "CLOSED",
    closed_at: nowIso(),
    closed_by: ctx.session.profileId && isUuid(ctx.session.profileId) ? ctx.session.profileId : null,
    close_note: optionalText(ctx.body.note, "Catatan penutupan", 1000)
  });
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "OPERATION_CLOSE", entityType: "operations",
    entityId: String(operation.id), summary: "Operasi ditutup; akses data warga Rescue dicabut", before: operation, after: updated
  });
  // Operasi selesai: alarm kalung dilepas dan tombol kembali terkunci.
  await releaseVillageAlarms(ctx.store, String(operation.village_id));
  publish("operation.closed", { id: operation.id, villageId: operation.village_id }, String(operation.village_id));
  return (await shapeOperations(ctx.store, [updated ?? operation]))[0];
}

/**
 * Rute dari tim ke warga pemakai kalung dalam operasi. Titik tujuan = posisi GPS kalung bila segar, selain itu rumah.
 * Estimasi di sini berbasis jarak lurus + kesulitan akses + zona bahaya; peta di antarmuka memakai jaringan jalan bila tersedia.
 */
export async function operationRoute(ctx: Ctx) {
  const operation = await loadOperation(ctx);
  const residentId = clean(ctx.query.get("residentId"));
  if (!isUuid(residentId)) throw badRequest("Parameter residentId wajib diisi");
  const target = (await rosterFor(ctx, operation)).find(item => item.residentId === residentId);
  if (!target) throw notFound("Warga tidak ada pada roster operasi ini");
  if (target.latitude === null || target.longitude === null) throw badRequest("Warga belum punya koordinat (rumah maupun GPS)");
  const to = { latitude: Number(target.latitude), longitude: Number(target.longitude) };

  const villageId = String(operation.village_id);
  const [village, zones, teams] = await Promise.all([
    ctx.store.one("villages", { eq: { id: villageId } }),
    ctx.store.list("hazard_zones", { eq: { village_id: villageId } }),
    ctx.store.list("rescue_teams", {})
  ]);
  const visible = teams.filter(team => ctx.session.role !== "RESCUE" || String(team.organization_id ?? "") === String(ctx.session.organizationId ?? ""));
  const teamId = clean(ctx.query.get("teamId"));
  const team = teamId ? visible.find(item => String(item.id) === teamId) : visible.find(item => item.latitude !== null && item.latitude !== undefined);
  if (teamId && !team) throw notFound("Tim tidak ditemukan atau bukan milik organisasi Anda");

  let origin: { latitude: number; longitude: number; label: string } | null = null;
  if (team && team.latitude !== null && team.latitude !== undefined) origin = { latitude: Number(team.latitude), longitude: Number(team.longitude), label: String(team.name) };
  else if (village && village.latitude !== null && village.latitude !== undefined) origin = { latitude: Number(village.latitude), longitude: Number(village.longitude), label: `Pusat ${village.name}` };
  if (!origin) throw badRequest("Posisi tim dan desa belum diketahui");

  const options = { from: origin, to, hazards: zones, accessNotes: village?.access_notes ?? null };
  const fastest = estimateRoute(options);
  const safest = estimateAlternativeRoute(options, "aman");
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "OPERATION_ROUTE_VIEW", entityType: "residents", entityId: residentId,
    summary: `Rute ke warga pada operasi ${operation.id}`
  });
  return {
    operationId: operation.id,
    residentId,
    residentName: target.fullName,
    from: origin,
    to: { ...to, source: target.positionSource, positionAt: target.positionAt ?? null, accuracyMeters: target.positionAccuracyMeters ?? null },
    fastest,
    safest,
    navigation: {
      google: `https://www.google.com/maps/dir/?api=1&origin=${origin.latitude},${origin.longitude}&destination=${to.latitude},${to.longitude}&travelmode=driving`,
      osm: `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${origin.latitude}%2C${origin.longitude}%3B${to.latitude}%2C${to.longitude}`
    },
    note: "Estimasi. Banjir dapat memutus jalan; konfirmasi kondisi jalan di lapangan."
  };
}
