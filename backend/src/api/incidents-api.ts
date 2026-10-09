import { actorOf, record } from "../audit.js";
import { releaseDeviceAlarm } from "./alerts-api.js";
import { assertVillageAccess, requireRole } from "../auth.js";
import { accessProfile, estimateAlternativeRoute, estimateRoute, isValidPoint, riskBand } from "../geo.js";
import { eqFilter } from "./common.js";
import {
  badRequest, clean, conflict, forbidden, indexBy, notFound, nowIso, oneOf, optionalText, text
} from "../lib.js";
import { publish } from "../realtime.js";
import {
  activeRuleSet, assessmentFactors, incidentFactors, LEVEL_LABEL, mergeFactors, parseOverrideLevel, profileFactors, recommend
} from "../recommend.js";
import { param, type Ctx } from "../router.js";
import type { GeoPoint, IncidentStatus, RecommendationLevel, Row } from "../types.js";
import { loadSupportProfile, parsePaging, scopedQuery } from "./common.js";

const STATUSES: IncidentStatus[] = [
  "NEW", "ACKNOWLEDGED", "ASSIGNED", "EN_ROUTE", "ARRIVED", "EVACUATED", "NOT_FOUND", "UNREACHABLE", "SAFE", "CANCELLED", "CLOSED"
];
const SEVERITIES = ["WASPADA", "SIAGA", "AWAS"] as const;
const CLOSED = new Set(["SAFE", "CANCELLED", "CLOSED"]);

const timestampFor = (status: IncidentStatus): string | null => ({
  ACKNOWLEDGED: "acknowledged_at",
  EVACUATED: "evacuated_at",
  SAFE: "closed_at",
  CANCELLED: "closed_at",
  CLOSED: "closed_at"
} as Record<string, string>)[status] ?? null;

const statusLabel = (status: string) => ({
  NEW: "Baru diterima",
  ACKNOWLEDGED: "Diteruskan ke petugas",
  ASSIGNED: "Tim ditugaskan",
  EN_ROUTE: "Tim menuju lokasi",
  ARRIVED: "Tim tiba di lokasi",
  EVACUATED: "Warga sudah dievakuasi",
  NOT_FOUND: "Warga tidak ditemukan",
  UNREACHABLE: "Lokasi tidak terjangkau",
  SAFE: "Warga dinyatakan aman",
  CANCELLED: "Laporan dibatalkan",
  CLOSED: "Ditutup"
} as Record<string, string>)[status] ?? status;


const stripSensitive = (row: Row): Row => {
  const { birth_date: _birth, national_id_encrypted: _nik, consented_at: _consent, gender: _gender, ...rest } = row;
  return rest;
};

/* ------------------------------------------------------------------ Baca */

export async function listIncidents(ctx: Ctx) {
  const { limit, offset } = parsePaging(ctx.query, 500);
  const statusFilter = clean(ctx.query.get("status"));
  const villageId = clean(ctx.query.get("villageId"));
  const open = ctx.query.get("open");

  const rows = await ctx.store.list("incidents", scopedQuery(ctx.session, "village_id", {
    ...eqFilter(villageId ? { village_id: villageId } : null, statusFilter ? { status: statusFilter.toUpperCase() } : null),
    order: { created_at: "desc" }
  }));
  const filtered = open === "true" ? rows.filter(row => !CLOSED.has(String(row.status))) : rows;
  const window = filtered.slice(offset, offset + limit);

  const ids = window.map(row => String(row.id));
  const [recommendations, assignments, residents] = await Promise.all([
    ids.length ? ctx.store.list("priority_recommendations", { in: { incident_id: ids }, isNull: { superseded_at: true } }) : [],
    ids.length ? ctx.store.list("incident_assignments", { in: { incident_id: ids } }) : [],
    window.some(row => row.resident_id)
      ? ctx.store.list("residents", { in: { id: window.filter(row => row.resident_id).map(row => String(row.resident_id)) } })
      : []
  ]);
  const residentMap = indexBy(residents, row => String(row.id));
  const teamIds = Array.from(new Set(assignments.map(row => String(row.team_id))));
  const teams = teamIds.length ? await ctx.store.list("rescue_teams", { in: { id: teamIds } }) : [];
  const teamMap = indexBy(teams, row => String(row.id));
  const overrides = recommendations.length
    ? await ctx.store.list("priority_overrides", { in: { recommendation_id: recommendations.map(row => String(row.id)) } })
    : [];
  const latestOverride = new Map<string, Row>();
  for (const row of overrides) {
    const key = String(row.incident_id);
    const current = latestOverride.get(key);
    if (!current || String(row.created_at) > String(current.created_at)) latestOverride.set(key, row);
  }

  return {
    total: filtered.length,
    limit,
    offset,
    data: window.map(row => {
      const incidentId = String(row.id);
      const recommendation = recommendations.find(item => String(item.incident_id) === incidentId) ?? null;
      const override = latestOverride.get(incidentId) ?? null;
      const incidentTeams = assignments.filter(item => String(item.incident_id) === incidentId);
      return {
        id: row.id,
        villageId: row.village_id,
        residentId: row.resident_id,
        residentName: row.resident_id ? residentMap.get(String(row.resident_id))?.full_name ?? null : null,
        deviceId: row.device_id,
        disasterType: row.disaster_type,
        severity: row.severity ?? null,
        affectedCount: row.affected_count ?? null,
        ownerName: row.owner_name,
        latitude: row.latitude,
        longitude: row.longitude,
        status: row.status,
        statusLabel: statusLabel(String(row.status)),
        description: row.description,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        teams: incidentTeams.map(item => ({
          id: String(item.team_id),
          name: teamMap.get(String(item.team_id))?.name ?? item.team_id,
          callSign: teamMap.get(String(item.team_id))?.call_sign ?? null,
          status: teamMap.get(String(item.team_id))?.status ?? null
        })),
        recommendation: recommendation ? {
          id: recommendation.id,
          score: recommendation.score,
          suggestedLevel: override?.selected_level ?? recommendation.suggested_level,
          suggestedLevelLabel: LEVEL_LABEL[(override?.selected_level ?? recommendation.suggested_level) as RecommendationLevel],
          originalLevel: recommendation.suggested_level,
          overridden: Boolean(override),
          overrideReason: override?.reason ?? null,
          reasons: recommendation.reasons ?? [],
          dataCompleteness: recommendation.data_completeness,
          calculatedAt: recommendation.calculated_at
        } : null
      };
    })
  };
}

export async function getIncident(ctx: Ctx) {
  const incident = await ctx.store.one("incidents", { eq: { id: param(ctx, "id") } });
  if (!incident) throw notFound("Insiden tidak ditemukan");
  assertVillageAccess(ctx.session, incident.village_id);

  const [history, assessments, recommendations, assignments, routes, receipts] = await Promise.all([
    ctx.store.list("incident_status_history", { eq: { incident_id: param(ctx, "id") }, order: { created_at: "asc" } }),
    ctx.store.list("incident_assessments", { eq: { incident_id: param(ctx, "id") }, order: { observed_at: "desc" } }),
    ctx.store.list("priority_recommendations", { eq: { incident_id: param(ctx, "id") }, order: { calculated_at: "desc" } }),
    ctx.store.list("incident_assignments", { eq: { incident_id: param(ctx, "id") } }),
    ctx.store.list("evacuation_routes", { eq: { incident_id: param(ctx, "id") } }),
    ctx.store.list("alert_commands", { eq: { village_id: String(incident.village_id ?? "") }, order: { created_at: "desc" }, limit: 10 })
  ]);

  const fullProfile = incident.resident_id ? await loadSupportProfile(ctx.store, String(incident.resident_id)) : null;
  // Rescue: profil hanya untuk insiden yang masih terbuka dan tanpa NIK/tanggal lahir/persetujuan.
  const resident = ctx.session.role !== "RESCUE" ? fullProfile
    : fullProfile && !CLOSED.has(String(incident.status))
      ? { ...fullProfile, resident: stripSensitive(fullProfile.resident) }
      : null;
  const village = incident.village_id ? await ctx.store.one("villages", { eq: { id: String(incident.village_id) } }) : null;

  return {
    id: incident.id,
    villageId: incident.village_id,
    villageName: village?.name ?? null,
    residentId: incident.resident_id,
    residentProfile: resident,
    deviceId: incident.device_id,
    disasterType: incident.disaster_type,
    severity: incident.severity ?? null,
    affectedCount: incident.affected_count ?? null,
    ownerName: incident.owner_name,
    latitude: incident.latitude,
    longitude: incident.longitude,
    status: incident.status,
    statusLabel: statusLabel(String(incident.status)),
    description: incident.description,
    resolutionNotes: incident.resolution_notes,
    createdAt: incident.created_at,
    acknowledgedAt: incident.acknowledged_at,
    evacuatedAt: incident.evacuated_at,
    closedAt: incident.closed_at,
    history,
    assessments,
    recommendations,
    assignments,
    routes,
    recentAlerts: receipts
  };
}

/* ----------------------------------------------------------------- Tulis */

export async function createSos(ctx: Ctx) {
  const body = ctx.body;
  const residentId = optionalText(body.residentId, "Warga");
  let villageId = optionalText(body.villageId, "Desa");
  let latitude = body.latitude === undefined || body.latitude === null || body.latitude === "" ? null : Number(body.latitude);
  let longitude = body.longitude === undefined || body.longitude === null || body.longitude === "" ? null : Number(body.longitude);
  let ownerName = optionalText(body.ownerName, "Nama pelapor", 160);
  let resident: Row | null = null;

  if (residentId) {
    const profile = await loadSupportProfile(ctx.store, residentId);
    if (!profile) throw badRequest("Warga tidak ditemukan");
    assertVillageAccess(ctx.session, profile.resident.village_id);
    resident = profile.resident;
    villageId = String(resident.village_id);
    ownerName = String(resident.full_name);
    if (latitude === null) latitude = resident.latitude === null ? null : Number(resident.latitude);
    if (longitude === null) longitude = resident.longitude === null ? null : Number(resident.longitude);
  } else {
    if (!villageId) throw badRequest("Sebutkan warga atau desa tujuan laporan");
    assertVillageAccess(ctx.session, villageId);
  }
  if (!ownerName) ownerName = "Pelapor tidak disebutkan";
  if (latitude === null || longitude === null) throw badRequest("Koordinat lokasi wajib diisi untuk laporan warga");
  if (!isValidPoint({ latitude, longitude })) throw badRequest("Koordinat tidak valid");

  const incident = await ctx.store.insert("incidents", {
    village_id: villageId,
    resident_id: residentId,
    device_id: optionalText(body.deviceId, "Perangkat"),
    disaster_type: optionalText(body.disasterType, "Jenis bencana", 80) ?? "LAINNYA",
    severity: body.severity ? oneOf(body.severity, SEVERITIES, "Tingkat kewaspadaan") : "WASPADA",
    affected_count: Math.max(1, Math.trunc(Number(body.affectedCount)) || 1),
    owner_name: ownerName,
    latitude,
    longitude,
    status: "NEW",
    description: optionalText(body.description, "Keterangan", 2000),
    source: ctx.device ? String(body.source ?? "DEVICE") : "MANUAL",
    created_at: nowIso(),
    updated_at: nowIso()
  });
  await ctx.store.insert("incident_status_history", {
    incident_id: incident.id,
    from_status: null,
    to_status: "NEW",
    changed_by: actorOf(ctx.session),
    notes: optionalText(body.description, "Keterangan", 2000) ?? "Laporan diterima",
    created_at: nowIso()
  });
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "SOS_CREATE", entityType: "incidents",
    entityId: String(incident.id), summary: `Laporan SOS dari ${ownerName} (${incident.disaster_type})`, after: incident
  });
  publish("sos.created", { id: incident.id, owner_name: ownerName, status: "NEW" }, villageId);
  return incident;
}

export async function createSosPublic(ctx: Ctx) {
  if (ctx.session.role !== "DESA" && ctx.session.role !== "PUSAT") {
    throw forbidden("Hanya desa atau pusat yang dapat membuat laporan atas nama warga");
  }
  return createSos(ctx);
}

export async function updateIncidentStatus(ctx: Ctx) {
  const incident = await ctx.store.one("incidents", { eq: { id: param(ctx, "id") } });
  if (!incident) throw notFound("Insiden tidak ditemukan");
  assertVillageAccess(ctx.session, incident.village_id);
  const next = oneOf(ctx.body.status, STATUSES, "Status insiden");
  const previous = String(incident.status);
  if (previous === next) return { incident, message: statusLabel(next) };
  if (CLOSED.has(previous) && !CLOSED.has(next)) {
    throw conflict("Insiden yang sudah ditutup tidak dapat diaktifkan kembali. Buat laporan baru.");
  }
  if (ctx.session.role === "RESCUE" && ["CLOSED", "CANCELLED"].includes(next)) {
    throw forbidden("Hanya desa atau pusat yang dapat menutup atau membatalkan insiden");
  }

  const patch: Row = { status: next, updated_at: nowIso() };
  const stamp = timestampFor(next);
  if (stamp) patch[stamp] = nowIso();
  if (ctx.body.notes !== undefined) patch.resolution_notes = optionalText(ctx.body.notes, "Catatan", 2000);

  const updated = await ctx.store.update("incidents", param(ctx, "id"), patch);
  await ctx.store.insert("incident_status_history", {
    incident_id: param(ctx, "id"),
    from_status: previous,
    to_status: next,
    changed_by: actorOf(ctx.session),
    notes: optionalText(ctx.body.notes, "Catatan", 2000) ?? statusLabel(next),
    created_at: nowIso()
  });
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "INCIDENT_STATUS", entityType: "incidents",
    entityId: param(ctx, "id"), summary: `Status insiden ${previous} menjadi ${next}`, before: incident, after: updated
  });
  // Rescue memastikan warga aman atau dievakuasi: alarm kalung dilepas dan tombol kembali terkunci (SRS FR-4.3).
  if (["SAFE", "EVACUATED", "CANCELLED", "CLOSED"].includes(next) && incident.device_id) await releaseDeviceAlarm(ctx.store, String(incident.device_id));
  publish(next === "CLOSED" || next === "CANCELLED" ? "incident.closed" : "incident.updated", {
    id: param(ctx, "id"), status: next, statusLabel: statusLabel(next)
  }, String(incident.village_id ?? ""));
  return { incident: updated, message: statusLabel(next) };
}

export async function updateIncident(ctx: Ctx) {
  const incident = await ctx.store.one("incidents", { eq: { id: param(ctx, "id") } });
  if (!incident) throw notFound("Insiden tidak ditemukan");
  assertVillageAccess(ctx.session, incident.village_id);
  if (CLOSED.has(String(incident.status))) throw conflict("Insiden sudah ditutup");

  const patch: Row = { updated_at: nowIso() };
  if (ctx.body.description !== undefined) patch.description = optionalText(ctx.body.description, "Keterangan", 2000);
  if (ctx.body.severity !== undefined) patch.severity = oneOf(ctx.body.severity, SEVERITIES, "Tingkat kewaspadaan");
  if (ctx.body.affectedCount !== undefined) patch.affected_count = Number(ctx.body.affectedCount) || 1;
  if (ctx.body.disasterType !== undefined) patch.disaster_type = optionalText(ctx.body.disasterType, "Jenis bencana", 80);
  if (ctx.body.villageAccessNotes !== undefined) patch.village_access_notes = optionalText(ctx.body.villageAccessNotes, "Catatan akses", 500);
  const updated = await ctx.store.update("incidents", param(ctx, "id"), patch);
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "INCIDENT_UPDATE", entityType: "incidents",
    entityId: param(ctx, "id"), summary: "Memperbarui detail insiden", before: incident, after: updated
  });
  return updated;
}

/* ------------------------------------------------------------- Assessment */

export async function createAssessment(ctx: Ctx) {
  const incident = await ctx.store.one("incidents", { eq: { id: param(ctx, "id") } });
  if (!incident) throw notFound("Insiden tidak ditemukan");
  assertVillageAccess(ctx.session, incident.village_id);
  const source = oneOf(ctx.body.source ?? "RESCUE", ["DESA", "RESCUE", "DEVICE", "SYSTEM"] as const, "Sumber penilaian");
  const assessment = await ctx.store.insert("incident_assessments", {
    incident_id: param(ctx, "id"),
    assessed_by: actorOf(ctx.session),
    source,
    summary: optionalText(ctx.body.summary, "Ringkasan", 2000),
    observed_at: nowIso(),
    created_at: nowIso()
  });

  const factors = Array.isArray(ctx.body.factors) ? ctx.body.factors : [];
  if (factors.length) {
    const seen = new Set<string>();
    const rows = factors.map((factor: Row) => {
      const key = text(factor.key ?? factor.factor_key, "Kunci faktor", { max: 80 });
      if (seen.has(key)) throw badRequest(`Faktor ${key} muncul lebih dari sekali`);
      seen.add(key);
      return {
        assessment_id: assessment.id,
        factor_key: key,
        factor_value: factor.value ?? factor.factor_value ?? null,
        source_note: optionalText(factor.note, "Catatan sumber", 500),
        recorded_at: nowIso()
      };
    });
    await ctx.store.insertMany("assessment_factors", rows);
  }
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "ASSESSMENT_CREATE", entityType: "incidents",
    entityId: param(ctx, "id"), summary: `Penilaian lapangan (${source}) untuk insiden`, after: assessment
  });

  const recommendation = await calculateRecommendation(ctx.store, ctx.session.profileId, String(incident.id), { persist: true });
  publish("recommendation.updated", { incident_id: param(ctx, "id") }, String(incident.village_id ?? ""));
  return { assessment, recommendation };
}

async function collectFactors(store: Ctx["store"], incident: Row) {
  const resident = incident.resident_id ? await loadSupportProfile(store, String(incident.resident_id)) : null;
  const [assessments, telemetry] = await Promise.all([
    store.list("incident_assessments", { eq: { incident_id: String(incident.id) }, order: { observed_at: "asc" } }),
    incident.device_id ? store.first("device_telemetry", { eq: { device_id: String(incident.device_id) }, order: { recorded_at: "desc" } }) : null
  ]);

  const withFactors = [];
  for (const assessment of assessments) {
    const factors = await store.list("assessment_factors", { eq: { assessment_id: String(assessment.id) } });
    withFactors.push({ ...assessment, factors });
  }

  const profile = resident
    ? profileFactors(resident.resident, resident.vulnerabilities, resident.contacts)
    : [];
  const village = incident.village_id ? await store.one("villages", { eq: { id: String(incident.village_id) } }) : null;
  const villageFactors = village ? [
    { key: "terrain_isolation", value: accessProfile(village.access_notes).difficulty, source: "PROFILE" as const, note: String(village.access_notes ?? "") }
  ] : [];

  const device = incident.device_id ? await store.one("devices", { eq: { id: String(incident.device_id) } }) : null;
  const zones = incident.village_id ? await store.list("hazard_zones", { eq: { village_id: String(incident.village_id) } }) : [];
  // Pengamatan tinggi air Desa pada operasi aktif: tersedia sebagai faktor tersendiri (bukan menggantikan flood_depth_cm),
  // sehingga baru berpengaruh bila aturan yang disahkan Pusat memakainya.
  const operation = incident.village_id ? await store.one("operations", { eq: { village_id: String(incident.village_id), status: "ACTIVE" } }) : null;
  const operationFactors = operation && operation.water_level_cm !== null && operation.water_level_cm !== undefined
    ? [{ key: "operation_water_level_cm", value: Number(operation.water_level_cm), source: "INCIDENT" as const, note: "Pengamatan JAGA Desa pada operasi aktif (umum, bukan di rumah warga)" }]
    : [];
  return mergeFactors(profile, villageFactors, incidentFactors(incident, telemetry, device, zones), operationFactors, assessmentFactors(withFactors));
}

export async function calculateRecommendation(store: Ctx["store"], actorId: string | null, incidentId: string, options: { persist?: boolean } = {}) {
  const incident = await store.one("incidents", { eq: { id: incidentId } });
  if (!incident) throw notFound("Insiden tidak ditemukan");
  const { ruleSet, rules, bands, fallback } = await activeRuleSet(store, optionalText(incident.disaster_type, "Jenis"));

  const factors = await collectFactors(store, incident);
  // Override hanya berlaku untuk rekomendasi yang ia ubah. Setelah penilaian baru dan perhitungan ulang,
  // sistem menampilkan hasil terbaru; override lama tetap tersimpan sebagai riwayat.
  const current = await store.one("priority_recommendations", { eq: { incident_id: incidentId }, isNull: { superseded_at: true } });
  const overrides = current ? await store.list("priority_overrides", { eq: { recommendation_id: String(current.id) } }) : [];
  const lastOverride = overrides.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null;
  const result = recommend({
    ruleSet,
    rules,
    bands,
    factors,
    overrideLevel: lastOverride ? (String(lastOverride.selected_level) as RecommendationLevel) : null,
    overrideReason: lastOverride ? String(lastOverride.reason) : null
  });

  const note = fallback ? { ruleSetFallback: true, ruleSetNote: `Tidak ada rule set aktif untuk jenis bencana ini; memakai ${ruleSet.name} v${ruleSet.version}. Petugas perlu memeriksa.` } : { ruleSetFallback: false };
  if (!options.persist) return { ...result, ...note, factors };

  const assessment = await store.one("incident_assessments", { eq: { incident_id: incidentId }, order: { observed_at: "desc" } });
  if (!assessment) throw badRequest("Buat penilaian lapangan terlebih dahulu sebelum menghitung rekomendasi");

  await store.updateWhere("priority_recommendations", { eq: { incident_id: incidentId }, isNull: { superseded_at: true } }, { superseded_at: nowIso() });
  const saved = await store.insert("priority_recommendations", {
    incident_id: incidentId,
    assessment_id: assessment.id,
    rule_set_id: String(ruleSet.id),
    score: result.score,
    suggested_level: result.systemLevel,
    reasons: result.reasons,
    data_completeness: result.dataCompleteness,
    calculated_at: nowIso()
  });
  void actorId;
  return { ...result, ...note, factors, saved };
}

export async function recalculateRecommendation(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT", "DESA", "RESCUE"]);
  const incident = await ctx.store.one("incidents", { eq: { id: param(ctx, "id") } });
  if (!incident) throw notFound("Insiden tidak ditemukan");
  assertVillageAccess(ctx.session, incident.village_id);
  return calculateRecommendation(ctx.store, ctx.session.profileId, param(ctx, "id"), { persist: true });
}

export async function previewRecommendation(ctx: Ctx) {
  const incident = await ctx.store.one("incidents", { eq: { id: param(ctx, "id") } });
  if (!incident) throw notFound("Insiden tidak ditemukan");
  assertVillageAccess(ctx.session, incident.village_id);
  return calculateRecommendation(ctx.store, ctx.session.profileId, param(ctx, "id"), { persist: false });
}

export async function overrideRecommendation(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT", "DESA", "RESCUE"], "Peran Anda tidak dapat mengubah level prioritas");
  const incident = await ctx.store.one("incidents", { eq: { id: param(ctx, "id") } });
  if (!incident) throw notFound("Insiden tidak ditemukan");
  assertVillageAccess(ctx.session, incident.village_id);
  const recommendation = await activeRecommendation(ctx);
  if (!recommendation) throw badRequest("Belum ada rekomendasi untuk insiden ini. Hitung rekomendasi terlebih dahulu.");
  const level = parseOverrideLevel(ctx.body.level);
  if (!level) throw badRequest("Level baru wajib diisi");
  const reason = text(ctx.body.reason, "Alasan perubahan", { min: 10, max: 1000 });

  const override = await ctx.store.insert("priority_overrides", {
    recommendation_id: recommendation.id,
    incident_id: param(ctx, "id"),
    previous_level: recommendation.suggested_level,
    selected_level: level,
    reason,
    overridden_by: actorOf(ctx.session),
    created_at: nowIso()
  });
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "RECOMMENDATION_OVERRIDE", entityType: "incidents",
    entityId: param(ctx, "id"), summary: `Level prioritas diubah menjadi ${level}`, before: recommendation, after: override
  });
  publish("recommendation.updated", { incident_id: param(ctx, "id"), level }, String(incident.village_id ?? ""));
  return override;
}

const activeRecommendation = async (ctx: Ctx): Promise<Row | null> => {
  const rows = await ctx.store.list("priority_recommendations", { eq: { incident_id: param(ctx, "id") }, isNull: { superseded_at: true } });
  return rows[0] ?? null;
};

/* --------------------------------------------------------- Rute evakuasi */

export async function planRoutes(ctx: Ctx) {
  const incident = await ctx.store.one("incidents", { eq: { id: param(ctx, "id") } });
  if (!incident) throw notFound("Insiden tidak ditemukan");
  assertVillageAccess(ctx.session, incident.village_id);
  const villageId = String(incident.village_id ?? "");
  const from = { latitude: Number(incident.latitude), longitude: Number(incident.longitude) };
  const [zones, shelters] = await Promise.all([
    ctx.store.list("hazard_zones", { eq: { village_id: villageId } }),
    ctx.store.list("evacuation_shelters", { eq: { village_id: villageId } })
  ]);

  const accessNotes = optionalText(ctx.query.get("accessNotes"), "Catatan akses") ?? optionalText(incident.village_access_notes, "Catatan akses") ?? null;
  const shelterId = clean(ctx.query.get("shelterId"));
  const nearest = shelters.find(item => item.latitude !== null && item.longitude !== null);
  const target = shelterId
    ? await shelterPoint(ctx, shelterId)
    : nearest ? { latitude: Number(nearest.latitude), longitude: Number(nearest.longitude) } : from;
  const options = { from, to: target, hazards: zones, accessNotes };
  const fastest = estimateRoute(options);
  const safest = estimateAlternativeRoute(options, "aman");

  const shelterOptions = [];
  for (const shelter of shelters) {
    if (shelter.latitude === null || shelter.longitude === null) continue;
    const to = { latitude: Number(shelter.latitude), longitude: Number(shelter.longitude) };
    const estimate = estimateRoute({ ...options, to });
    shelterOptions.push({
      shelterId: shelter.id,
      shelterName: shelter.name,
      capacity: shelter.capacity ?? null,
      accessibilityNotes: shelter.accessibility_notes ?? null,
      path: estimate.path,
      distanceMeters: estimate.distanceMeters,
      durationSeconds: estimate.durationSeconds,
      riskScore: estimate.riskScore,
      riskBand: riskBand(estimate.riskScore),
      confidence: estimate.confidence
    });
  }
  shelterOptions.sort((a, b) => a.durationSeconds - b.durationSeconds);

  return {
    note: "Estimasi berbasis jarak lurus, kesulitan akses, dan zona bahaya. Belum memakai jaringan jalan; konfirmasi di lapangan.",
    accessProfile: accessProfile(accessNotes),
    fastest,
    safest,
    shelterOptions,
    hazards: zones.map(zone => ({
      id: zone.id, name: zone.name, riskLevel: zone.risk_level,
      centerLatitude: zone.center_latitude ?? null, centerLongitude: zone.center_longitude ?? null,
      radiusMeters: zone.radius_meters ?? null
    }))
  };
}

const shelterPoint = async (ctx: Ctx, shelterId: string): Promise<GeoPoint> => {
  const shelter = await ctx.store.one("evacuation_shelters", { eq: { id: shelterId } });
  if (!shelter || shelter.latitude === null || shelter.longitude === null) {
    throw badRequest("Shelter tujuan tidak memiliki koordinat");
  }
  return { latitude: Number(shelter.latitude), longitude: Number(shelter.longitude) };
};

export async function saveRoute(ctx: Ctx) {
  const incident = await ctx.store.one("incidents", { eq: { id: param(ctx, "id") } });
  if (!incident) throw notFound("Insiden tidak ditemukan");
  assertVillageAccess(ctx.session, incident.village_id);
  const points = Array.isArray(ctx.body.path) ? ctx.body.path : [];
  if (points.length < 2) throw badRequest("Rute membutuhkan minimal dua titik");
  if (points.length > 500) throw badRequest("Rute maksimal 500 titik");
  if (!points.every((point: Row) => isValidPoint({ latitude: Number(point.latitude), longitude: Number(point.longitude) }))) {
    throw badRequest("Koordinat titik rute tidak valid");
  }
  const line = points.map((point: Row) => `${Number(point.longitude)} ${Number(point.latitude)}`).join(",");
  const route = await ctx.store.insert("evacuation_routes", {
    incident_id: param(ctx, "id"),
    team_id: optionalText(ctx.body.teamId, "Tim"),
    shelter_id: optionalText(ctx.body.shelterId, "Shelter"),
    path_wkt: `SRID=4326;LINESTRING(${line})`,
    distance_meters: Number(ctx.body.distanceMeters ?? 0),
    estimated_seconds: Number(ctx.body.estimatedSeconds ?? 0),
    risk_score: Math.min(5, Math.max(1, Math.round(Number(ctx.body.riskScore ?? 2)) || 2)),
    notes: optionalText(ctx.body.notes, "Catatan", 1000),
    created_at: nowIso()
  });
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "ROUTE_SAVE", entityType: "incidents",
    entityId: param(ctx, "id"), summary: "Menyimpan rencana rute evakuasi", after: route
  });
  return route;
}

/* -------------------------------------------------------- Lampiran & audit */

export async function listAttachments(ctx: Ctx) {
  const incident = await ctx.store.one("incidents", { eq: { id: param(ctx, "id") } });
  if (!incident) throw notFound("Insiden tidak ditemukan");
  assertVillageAccess(ctx.session, incident.village_id);
  return ctx.store.list("attachments", { eq: { incident_id: param(ctx, "id") }, order: { created_at: "desc" } });
}

export async function listIncidentAudit(ctx: Ctx) {
  const incident = await ctx.store.one("incidents", { eq: { id: param(ctx, "id") } });
  if (!incident) throw notFound("Insiden tidak ditemukan");
  assertVillageAccess(ctx.session, incident.village_id);
  const rows = await ctx.store.list("audit_logs", { eq: { entity_id: param(ctx, "id") } });
  return rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export const incidentStatuses = () => STATUSES.map(status => ({ value: status, label: statusLabel(status) }));
export { statusLabel };
