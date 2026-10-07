import { actorOf, record } from "../audit.js";
import { assertVillageAccess, requireRole, scopeIds } from "../auth.js";
import {
  badRequest, clean, conflict, forbidden, indexBy, isUuid, notFound, nowIso, oneOf, optionalText, requireUuid, text
} from "../lib.js";
import { publish } from "../realtime.js";
import { ageFrom, profileFactors } from "../recommend.js";
import { param, type Ctx } from "../router.js";
import type { Row } from "../types.js";
import { eqFilter, loadSupportProfile, parsePaging, scopedQuery, searchText } from "./common.js";
import { rescueResidentView } from "./operations-api.js";

const GENDERS = ["LAKI_LAKI", "PEREMPUAN", "LAINNYA"] as const;
const EVACUATION_ABILITIES = ["MANDIRI", "PERLU_BANTUAN", "TIDAK_BISA_SENDIRI"] as const;

/* ------------------------------------------------------------- Dictionari */

export async function listVulnerabilityTypes(ctx: Ctx) {
  const rows = await ctx.store.list("vulnerability_types", { eq: { active: true }, order: { name: "asc" } });
  return rows.map(row => ({
    id: row.id,
    category: row.category,
    code: row.code,
    name: row.name,
    description: row.description,
    defaultAssistance: row.default_assistance
  }));
}

export async function listVillages(ctx: Ctx) {
  const ids = scopeIds(ctx.session);
  const rows = await ctx.store.list("villages", {
    ...(ids === null ? {} : ids.length ? { in: { id: ids } } : { in: { id: ["__tidak_ada__"] } }),
    order: { name: "asc" }
  });
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    province: row.province ?? null,
    regency: row.regency ?? null,
    district: row.district ?? null,
    population: row.population ?? null,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    accessNotes: row.access_notes ?? null,
    center: row.center ?? null,
    headName: row.head_name ?? null,
    headPhone: row.head_phone ?? null
  }));
}

/** Kontak kepala desa dikelola JAGA Pusat (FR-1.7 untuk penerima pengumuman). */
export async function updateVillage(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT"], "Kontak kepala desa hanya dikelola JAGA Pusat");
  const village = await ctx.store.one("villages", { eq: { id: requireUuid(param(ctx, "id"), "ID desa") } });
  if (!village) throw notFound("Desa tidak ditemukan");
  const patch: Row = {};
  if (ctx.body.headName !== undefined) patch.head_name = ctx.body.headName === null ? null : text(ctx.body.headName, "Nama kepala desa", { min: 2, max: 160 });
  if (ctx.body.headPhone !== undefined) patch.head_phone = ctx.body.headPhone === null ? null : optionalText(ctx.body.headPhone, "Telepon kepala desa", 30);
  if (!Object.keys(patch).length) throw badRequest("Kirim headName dan/atau headPhone");
  const row = await ctx.store.update("villages", String(village.id), patch);
  await record(ctx.store, {
    actorId: actorOf(ctx.session), action: "VILLAGE_HEADS", entityType: "villages", entityId: String(village.id),
    summary: `Kontak kepala desa ${village.name} diperbarui`
  });
  return {
    id: row?.id, name: row?.name ?? village.name, headName: row?.head_name ?? patch.head_name ?? null, headPhone: row?.head_phone ?? patch.head_phone ?? null
  };
}

export async function listHazardZones(ctx: Ctx) {
  const rows = await ctx.store.list("hazard_zones", scopedQuery(ctx.session, "village_id", { order: { name: "asc" } }));
  return rows.map(row => ({
    id: row.id,
    villageId: row.village_id,
    name: row.name,
    hazardType: row.hazard_type,
    riskLevel: row.risk_level,
    centerLatitude: row.center_latitude ?? null,
    centerLongitude: row.center_longitude ?? null,
    radiusMeters: row.radius_meters ?? null,
    accessNotes: row.access_notes ?? null,
    activeFrom: row.active_from ?? null,
    activeUntil: row.active_until ?? null
  }));
}

export async function listShelters(ctx: Ctx) {
  const rows = await ctx.store.list("evacuation_shelters", scopedQuery(ctx.session, "village_id", { order: { name: "asc" } }));
  return rows.map(row => ({
    id: row.id,
    villageId: row.village_id,
    name: row.name,
    address: row.address,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    capacity: row.capacity ?? null,
    accessibilityNotes: row.accessibility_notes,
    active: row.active !== false
  }));
}

/* ---------------------------------------------------------------- Warga */

export async function listResidents(ctx: Ctx) {
  if (ctx.session.role === "RESCUE") {
    throw forbidden("Rescue tidak membuka daftar warga. Gunakan roster operasi aktif: GET /api/operations/:id/roster");
  }
  const { limit, offset } = parsePaging(ctx.query, 1000);
  const villageId = clean(ctx.query.get("villageId"));
  const term = clean(ctx.query.get("q")).toLowerCase();
  const activeParam = ctx.query.get("active");

  const rows = await ctx.store.list("residents", scopedQuery(ctx.session, "village_id", {
    ...eqFilter(
      villageId ? { village_id: villageId } : null,
      // Default hanya warga aktif; ?active=false menampilkan yang dinonaktifkan, ?active=all menampilkan semuanya.
      activeParam === "all" ? null : { active: activeParam === null ? true : activeParam !== "false" }
    ),
    order: { full_name: "asc" }
  }));

  const filtered = searchText(rows, term, ["full_name", "phone", "address"]);
  const window = filtered.slice(offset, offset + limit);

  const ids = window.map(row => String(row.id));
  const [vulns, types, assignments] = await Promise.all([
    ids.length ? ctx.store.list("resident_vulnerabilities", { in: { resident_id: ids } }) : [],
    ctx.store.list("vulnerability_types", {}),
    ids.length ? ctx.store.list("device_assignments", { in: { resident_id: ids }, isNull: { unassigned_at: true } }) : []
  ]);
  const typeMap = indexBy(types, row => String(row.id));
  const assignmentMap = new Map(assignments.map(row => [String(row.resident_id), row]));

  return {
    total: filtered.length,
    limit,
    offset,
    data: window.map(row => {
      const residentId = String(row.id);
      const residentVulns = vulns.filter(vuln => String(vuln.resident_id) === residentId);
      return {
        id: row.id,
        villageId: row.village_id,
        fullName: row.full_name,
        age: ageFrom(row.birth_date),
        birthDate: row.birth_date,
        gender: row.gender,
        phone: row.phone,
        address: row.address,
        latitude: row.latitude,
        longitude: row.longitude,
        livesAlone: row.lives_alone === true,
        evacuationAbility: row.evacuation_ability ?? null,
        timeCriticalMedical: row.time_critical_medical === true,
        mobilityNotes: row.mobility_notes,
        medicalNotes: row.medical_notes,
        evacuationNotes: row.evacuation_notes,
        active: row.active !== false,
        vulnerabilityCount: residentVulns.length,
        vulnerabilities: residentVulns.map(vuln => {
          const type = typeMap.get(String(vuln.vulnerability_type_id));
          return { id: vuln.vulnerability_type_id, name: type?.name ?? null, category: type?.category ?? null, severity: vuln.severity ?? null };
        }),
        vulnerabilityCategories: residentVulns
          .map(vuln => typeMap.get(String(vuln.vulnerability_type_id))?.category)
          .filter(Boolean),
        deviceId: assignmentMap.get(residentId)?.device_id ?? null
      };
    })
  };
}

export async function getResident(ctx: Ctx) {
  if (ctx.session.role === "RESCUE") return rescueResidentView(ctx);
  const profile = await loadSupportProfile(ctx.store, param(ctx, "id"));
  if (!profile) throw notFound("Warga tidak ditemukan");
  assertVillageAccess(ctx.session, profile.resident.village_id);
  const factors = profileFactors(profile.resident, profile.vulnerabilities, profile.contacts);
  return {
    ...profile,
    age: ageFrom(profile.resident.birth_date),
    priorityFactors: factors,
    factorGaps: factors.filter(factor => factor.value === null || factor.value === "" || (Array.isArray(factor.value) && !factor.value.length))
  };
}

/** Tanggal lahir opsional dalam format YYYY-MM-DD, tidak di masa depan. */
const parseBirthDate = (value: unknown): string | null => {
  const raw = optionalText(value, "Tanggal lahir", 30);
  if (!raw) return null;
  const date = new Date(raw);
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw) || Number.isNaN(date.getTime()) || date.getTime() > Date.now()) {
    throw badRequest("Tanggal lahir tidak valid (format YYYY-MM-DD, tidak boleh di masa depan)");
  }
  return raw.slice(0, 10);
};

export async function createResident(ctx: Ctx) {
  if (ctx.session.role === "RESCUE") throw forbidden("Tim rescue tidak dapat menambah warga");
  const body = ctx.body;
  const villageId = requireUuid(body.villageId ?? body.village_id, "Desa");
  assertVillageAccess(ctx.session, villageId);
  const village = await ctx.store.one("villages", { eq: { id: villageId } });
  if (!village) throw badRequest("Desa tidak ditemukan");

  const latitude = body.latitude === undefined || body.latitude === null || body.latitude === "" ? null : Number(body.latitude);
  const longitude = body.longitude === undefined || body.longitude === null || body.longitude === "" ? null : Number(body.longitude);
  if ((latitude === null) !== (longitude === null)) throw badRequest("Latitude dan longitude harus diisi bersama");
  if (latitude !== null && (Math.abs(latitude) > 90 || Math.abs(longitude as number) > 180)) throw badRequest("Koordinat di luar batas bumi");

  if (body.consented !== true) throw badRequest("Persetujuan pendataan (consented) wajib diberikan oleh warga atau walinya");
  const birthDate = parseBirthDate(body.birthDate);

  const resident = await ctx.store.insert("residents", {
    village_id: villageId,
    full_name: text(body.fullName ?? body.full_name, "Nama lengkap", { max: 160 }),
    birth_date: birthDate,
    gender: body.gender ? oneOf(body.gender, GENDERS, "Jenis kelamin") : null,
    phone: optionalText(body.phone, "Telepon", 40),
    address: optionalText(body.address, "Alamat", 500),
    latitude,
    longitude,
    lives_alone: Boolean(body.livesAlone),
    evacuation_ability: body.evacuationAbility ? oneOf(body.evacuationAbility, EVACUATION_ABILITIES, "Kemampuan evakuasi") : null,
    time_critical_medical: Boolean(body.timeCriticalMedical),
    mobility_notes: optionalText(body.mobilityNotes, "Catatan mobilitas", 500),
    communication_notes: optionalText(body.communicationNotes, "Catatan komunikasi", 500),
    medical_notes: optionalText(body.medicalNotes, "Catatan medis", 500),
    evacuation_notes: optionalText(body.evacuationNotes, "Catatan evakuasi", 500),
    active: true,
    consented_at: nowIso(),
    created_at: nowIso(),
    updated_at: nowIso()
  });
  const codes = Array.isArray(body.vulnerabilityCodes) ? body.vulnerabilityCodes.map(String).slice(0, 20) : [];
  if (codes.length) {
    const types = await ctx.store.list("vulnerability_types", { in: { code: codes } });
    if (types.length) {
      await ctx.store.insertMany("resident_vulnerabilities", types.map(type => ({
        resident_id: resident.id, vulnerability_type_id: type.id, severity: 3, verified_by: null
      })));
    }
  }
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "RESIDENT_CREATE", entityType: "residents",
    entityId: String(resident.id), summary: `Menambah warga ${resident.full_name}`, after: resident
  });
  publish("resident.created", { id: resident.id, full_name: resident.full_name }, villageId);
  return resident;
}

export async function updateResident(ctx: Ctx) {
  if (ctx.session.role === "RESCUE") throw forbidden("Tim rescue tidak dapat mengubah data warga");
  const existing = await ctx.store.one("residents", { eq: { id: param(ctx, "id") } });
  if (!existing) throw notFound("Warga tidak ditemukan");
  assertVillageAccess(ctx.session, existing.village_id, "Warga ini berada di luar kewenangan Anda");

  const body = ctx.body;
  const patch: Row = { updated_at: nowIso() };
  if (body.fullName !== undefined) patch.full_name = text(body.fullName, "Nama lengkap", { max: 160 });
  if (body.birthDate !== undefined) patch.birth_date = parseBirthDate(body.birthDate);
  if (body.gender !== undefined) patch.gender = body.gender ? oneOf(body.gender, GENDERS, "Jenis kelamin") : null;
  if (body.phone !== undefined) patch.phone = optionalText(body.phone, "Telepon", 40);
  if (body.address !== undefined) patch.address = optionalText(body.address, "Alamat", 500);
  if (body.livesAlone !== undefined) patch.lives_alone = Boolean(body.livesAlone);
  if (body.evacuationAbility !== undefined) patch.evacuation_ability = body.evacuationAbility ? oneOf(body.evacuationAbility, EVACUATION_ABILITIES, "Kemampuan evakuasi") : null;
  if (body.timeCriticalMedical !== undefined) patch.time_critical_medical = Boolean(body.timeCriticalMedical);
  if (body.mobilityNotes !== undefined) patch.mobility_notes = optionalText(body.mobilityNotes, "Catatan mobilitas", 500);
  if (body.communicationNotes !== undefined) patch.communication_notes = optionalText(body.communicationNotes, "Catatan komunikasi", 500);
  if (body.medicalNotes !== undefined) patch.medical_notes = optionalText(body.medicalNotes, "Catatan medis", 500);
  if (body.evacuationNotes !== undefined) patch.evacuation_notes = optionalText(body.evacuationNotes, "Catatan evakuasi", 500);
  if (body.active !== undefined) patch.active = Boolean(body.active);
  if (body.latitude !== undefined || body.longitude !== undefined) {
    const latitude = body.latitude === undefined ? existing.latitude : body.latitude === null ? null : Number(body.latitude);
    const longitude = body.longitude === undefined ? existing.longitude : body.longitude === null ? null : Number(body.longitude);
    if ((latitude === null || latitude === "") !== (longitude === null || longitude === "")) {
      throw badRequest("Latitude dan longitude harus diisi bersama");
    }
    patch.latitude = latitude === null || latitude === "" ? null : Number(latitude);
    patch.longitude = longitude === null || longitude === "" ? null : Number(longitude);
    if (patch.latitude !== null && (!Number.isFinite(patch.latitude) || !Number.isFinite(patch.longitude)
      || Math.abs(patch.latitude) > 90 || Math.abs(patch.longitude) > 180)) {
      throw badRequest("Koordinat di luar batas bumi");
    }
  }

  const updated = await ctx.store.update("residents", param(ctx, "id"), patch);
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "RESIDENT_UPDATE", entityType: "residents",
    entityId: param(ctx, "id"), summary: `Memperbarui warga ${existing.full_name}`, before: existing, after: updated
  });
  publish("resident.updated", { id: param(ctx, "id"), full_name: updated?.full_name }, String(existing.village_id));
  return updated;
}

export async function deleteResident(ctx: Ctx) {
  if (ctx.session.role !== "PUSAT" && ctx.session.role !== "DESA") {
    throw forbidden("Hanya pusat atau desa yang dapat menonaktifkan warga");
  }
  const existing = await ctx.store.one("residents", { eq: { id: param(ctx, "id") } });
  if (!existing) throw notFound("Warga tidak ditemukan");
  assertVillageAccess(ctx.session, existing.village_id, "Warga ini berada di luar kewenangan Anda");

  if (ctx.body.hard === true && ctx.session.role === "PUSAT") {
    const related = await ctx.store.list("incidents", { eq: { resident_id: param(ctx, "id") } });
    if (related.length) {
      throw conflict("Warga memiliki riwayat insiden sehingga tidak dapat dihapus permanen. Nonaktifkan saja.");
    }
    if (await ctx.store.one("device_assignments", { eq: { resident_id: param(ctx, "id") } })) {
      throw conflict("Warga masih memiliki riwayat pemasangan perangkat. Nonaktifkan saja.");
    }
    await ctx.store.remove("residents", param(ctx, "id"));
    await record(ctx.store, {
      actorId: ctx.session.profileId, action: "RESIDENT_DELETE", entityType: "residents",
      entityId: param(ctx, "id"), summary: `Menghapus warga ${existing.full_name}`, before: existing
    });
    return { deleted: true, hard: true };
  }

  const updated = await ctx.store.update("residents", param(ctx, "id"), { active: false, updated_at: nowIso() });
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "RESIDENT_DEACTIVATE", entityType: "residents",
    entityId: param(ctx, "id"), summary: `Menonaktifkan warga ${existing.full_name}`, before: existing, after: updated
  });
  return { deactivated: true };
}

/* ----------------------------------------------------- Kerentanan & kontak */

export async function saveVulnerabilities(ctx: Ctx) {
  forbidRescueEdit(ctx);
  const resident = await ctx.store.one("residents", { eq: { id: param(ctx, "id") } });
  if (!resident) throw notFound("Warga tidak ditemukan");
  assertVillageAccess(ctx.session, resident.village_id);
  const items = Array.isArray(ctx.body.vulnerabilities) ? ctx.body.vulnerabilities : [];
  if (!items.length) throw badRequest("Kirim minimal satu kelompok rentan");
  if (items.length > 20) throw badRequest("Maksimal 20 kelompok rentan per warga");

  const typeIds = Array.from(new Set(items.map(item => requireUuid(item.vulnerabilityTypeId ?? item.vulnerability_type_id, "Jenis kerentanan"))));
  const types = await ctx.store.list("vulnerability_types", { in: { id: typeIds } });
  const typeMap = indexBy(types, row => String(row.id));
  const missing = typeIds.filter(id => !typeMap.has(id));
  if (missing.length) throw badRequest("Jenis kerentanan tidak dikenal", { missing });

  // Satu baris per jenis (item terakhir menang) supaya upsert tidak menyentuh baris yang sama dua kali.
  const byType = new Map<string, Row>();
  for (const item of items) {
    const typeId = requireUuid(item.vulnerabilityTypeId ?? item.vulnerability_type_id, "Jenis kerentanan");
    byType.set(typeId, {
      resident_id: param(ctx, "id"),
      vulnerability_type_id: typeId,
      severity: item.severity === undefined ? 3 : Math.min(5, Math.max(1, Math.round(Number(item.severity)) || 3)),
      assistance_notes: optionalText(item.assistanceNotes ?? item.assistance_notes, "Catatan bantuan", 500),
      verified_by: isUuid(ctx.session.profileId) ? ctx.session.profileId : null,
      verified_at: nowIso()
    });
  }
  const rows = Array.from(byType.values());
  // Simpan dulu, hapus yang tidak dipilih belakangan: kegagalan simpan tidak menghilangkan data lama.
  const saved = await ctx.store.upsert("resident_vulnerabilities", rows, ["resident_id", "vulnerability_type_id"]);
  const existing = await ctx.store.list("resident_vulnerabilities", { eq: { resident_id: param(ctx, "id") } });
  for (const row of existing) {
    if (!byType.has(String(row.vulnerability_type_id))) {
      await ctx.store.removeWhere("resident_vulnerabilities", { eq: { resident_id: param(ctx, "id"), vulnerability_type_id: String(row.vulnerability_type_id) } });
    }
  }
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "RESIDENT_VULNERABILITY_SET", entityType: "residents",
    entityId: param(ctx, "id"), summary: `Memperbarui ${rows.length} kelompok rentan untuk ${resident.full_name}`
  });
  publish("resident.updated", { id: param(ctx, "id"), full_name: resident.full_name }, String(resident.village_id));
  return saved.map(row => ({ ...row, type: typeMap.get(String(row.vulnerability_type_id)) ?? null }));
}

/** Mengubah data warga hanya untuk pusat/desa; Rescue hanya membaca. */
const forbidRescueEdit = (ctx: Ctx) => {
  if (ctx.session.role === "RESCUE") throw forbidden("Tim rescue tidak dapat mengubah data warga");
};

export async function addContact(ctx: Ctx) {
  forbidRescueEdit(ctx);
  const resident = await ctx.store.one("residents", { eq: { id: param(ctx, "id") } });
  if (!resident) throw notFound("Warga tidak ditemukan");
  assertVillageAccess(ctx.session, resident.village_id);
  const phone = text(ctx.body.phone, "Telepon kontak", { max: 40 });
  const contact = await ctx.store.insert("resident_contacts", {
    resident_id: param(ctx, "id"),
    name: text(ctx.body.name, "Nama kontak", { max: 160 }),
    relationship: optionalText(ctx.body.relationship, "Hubungan", 80),
    phone,
    is_primary: Boolean(ctx.body.isPrimary),
    lives_with_resident: Boolean(ctx.body.livesWithResident)
  });
  if (ctx.body.isPrimary) {
    await ctx.store.updateWhere("resident_contacts", { eq: { resident_id: param(ctx, "id") }, neq: { id: String(contact.id) } }, { is_primary: false });
  }
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "RESIDENT_CONTACT_ADD", entityType: "residents",
    entityId: param(ctx, "id"), summary: `Menambah kontak ${contact.name} untuk ${resident.full_name}`
  });
  return contact;
}

export async function deleteContact(ctx: Ctx) {
  forbidRescueEdit(ctx);
  const contact = await ctx.store.one("resident_contacts", { eq: { id: param(ctx, "contactId"), resident_id: param(ctx, "id") } });
  if (!contact) throw notFound("Kontak tidak ditemukan");
  const resident = await ctx.store.one("residents", { eq: { id: String(contact.resident_id) } });
  if (!resident) throw notFound("Warga tidak ditemukan");
  assertVillageAccess(ctx.session, resident.village_id);
  await ctx.store.remove("resident_contacts", param(ctx, "contactId"));
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "RESIDENT_CONTACT_REMOVE", entityType: "residents",
    entityId: String(contact.resident_id), summary: `Menghapus kontak ${contact.name}`
  });
  return { deleted: true };
}

/* ------------------------------------------------- Titik evakuasi (Desa/Pusat) */

const shelterCoord = (value: unknown, field: string, limit: number): number => {
  const n = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n) || Math.abs(n) > limit) throw badRequest(`${field} tidak valid`);
  return n;
};
const shelterShape = (row: Row) => ({
  id: row.id, villageId: row.village_id, name: row.name, address: row.address ?? null,
  latitude: row.latitude ?? null, longitude: row.longitude ?? null, capacity: row.capacity ?? null,
  accessibilityNotes: row.accessibility_notes ?? null, active: row.active !== false
});
const shelterCapacity = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100000) throw badRequest("Kapasitas harus bilangan bulat 0 sampai 100000");
  return n;
};
async function ownShelter(ctx: Ctx): Promise<Row> {
  requireRole(ctx.session, ["PUSAT", "DESA"], "Hanya pusat atau desa yang dapat mengelola titik evakuasi");
  const shelter = await ctx.store.one("evacuation_shelters", { eq: { id: requireUuid(param(ctx, "id"), "ID titik evakuasi") } });
  if (!shelter) throw notFound("Titik evakuasi tidak ditemukan");
  assertVillageAccess(ctx.session, String(shelter.village_id));
  return shelter;
}

export async function createShelter(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT", "DESA"], "Hanya pusat atau desa yang dapat mengelola titik evakuasi");
  const own = ctx.session.villageIds?.length === 1 ? String(ctx.session.villageIds[0]) : "";
  const villageId = clean(ctx.body.villageId) || own;
  if (!villageId) throw badRequest("villageId wajib diisi");
  assertVillageAccess(ctx.session, villageId);
  const latitude = shelterCoord(ctx.body.latitude, "Lintang", 90), longitude = shelterCoord(ctx.body.longitude, "Bujur", 180);
  const row = await ctx.store.insert("evacuation_shelters", {
    village_id: villageId,
    name: text(ctx.body.name, "Nama titik evakuasi", { min: 3, max: 160 }),
    address: optionalText(ctx.body.address, "Alamat", 300),
    latitude, longitude, location: `SRID=4326;POINT(${longitude} ${latitude})`,
    capacity: shelterCapacity(ctx.body.capacity),
    accessibility_notes: optionalText(ctx.body.accessibilityNotes, "Catatan", 500),
    active: true
  });
  await record(ctx.store, { actorId: ctx.session.profileId, action: "SHELTER_CREATE", entityType: "evacuation_shelters", entityId: String(row.id), summary: String(row.name) });
  publish("shelter.updated", { id: row.id }, villageId);
  return shelterShape(row);
}

export async function updateShelter(ctx: Ctx) {
  const shelter = await ownShelter(ctx);
  const patch: Row = {};
  if (ctx.body.name !== undefined) patch.name = text(ctx.body.name, "Nama titik evakuasi", { min: 3, max: 160 });
  if (ctx.body.address !== undefined) patch.address = optionalText(ctx.body.address, "Alamat", 300);
  if (ctx.body.capacity !== undefined) patch.capacity = shelterCapacity(ctx.body.capacity);
  if (ctx.body.accessibilityNotes !== undefined) patch.accessibility_notes = optionalText(ctx.body.accessibilityNotes, "Catatan", 500);
  if (ctx.body.active !== undefined) patch.active = ctx.body.active === true || ctx.body.active === "true";
  if (ctx.body.latitude !== undefined || ctx.body.longitude !== undefined) {
    const latitude = shelterCoord(ctx.body.latitude ?? shelter.latitude, "Lintang", 90), longitude = shelterCoord(ctx.body.longitude ?? shelter.longitude, "Bujur", 180);
    Object.assign(patch, { latitude, longitude, location: `SRID=4326;POINT(${longitude} ${latitude})` });
  }
  if (!Object.keys(patch).length) throw badRequest("Tidak ada perubahan");
  const row = await ctx.store.update("evacuation_shelters", String(shelter.id), patch);
  await record(ctx.store, { actorId: ctx.session.profileId, action: "SHELTER_UPDATE", entityType: "evacuation_shelters", entityId: String(shelter.id), summary: String(shelter.name) });
  publish("shelter.updated", { id: shelter.id }, String(shelter.village_id));
  return shelterShape(row ?? { ...shelter, ...patch });
}

export async function deleteShelter(ctx: Ctx) {
  const shelter = await ownShelter(ctx);
  let deactivated = false;
  try { await ctx.store.remove("evacuation_shelters", String(shelter.id)); }
  catch { await ctx.store.update("evacuation_shelters", String(shelter.id), { active: false }); deactivated = true; } // masih dipakai rencana rute
  await record(ctx.store, { actorId: ctx.session.profileId, action: "SHELTER_DELETE", entityType: "evacuation_shelters", entityId: String(shelter.id), summary: String(shelter.name) });
  publish("shelter.updated", { id: shelter.id }, String(shelter.village_id));
  return { id: shelter.id, deleted: !deactivated, deactivated };
}
