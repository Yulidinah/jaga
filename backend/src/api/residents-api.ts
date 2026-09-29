import { record } from "../audit.js";
import { assertVillageAccess, scopeIds } from "../auth.js";
import {
  badRequest, clean, conflict, forbidden, indexBy, notFound, nowIso, oneOf, optionalText, requireUuid, text
} from "../lib.js";
import { publish } from "../realtime.js";
import { ageFrom, profileFactors } from "../recommend.js";
import { param, type Ctx } from "../router.js";
import type { Row } from "../types.js";
import { loadSupportProfile, parsePaging, scopedQuery, searchText } from "./common.js";

const GENDERS = ["LAKI_LAKI", "PEREMPUAN", "LAINNYA"] as const;

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
    hamletCount: row.hamlet_count ?? null,
    regency: row.regency ?? null,
    population: row.population ?? null,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    accessNotes: row.access_notes ?? null,
    center: row.center ?? null
  }));
}

export async function listHamlets(ctx: Ctx) {
  const ids = scopeIds(ctx.session);
  const villageId = clean(ctx.query.get("villageId"));
  const rows = await ctx.store.list("hamlets", {
    ...(ids === null ? {} : ids.length ? { in: { village_id: ids } } : { in: { village_id: ["__tidak_ada__"] } }),
    ...(villageId ? { eq: { village_id: villageId } } : {}),
    order: { name: "asc" }
  });
  return rows;
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
  const { limit, offset } = parsePaging(ctx.query, 1000);
  const villageId = clean(ctx.query.get("villageId"));
  const term = clean(ctx.query.get("q")).toLowerCase();
  const activeParam = ctx.query.get("active");

  const rows = await ctx.store.list("residents", scopedQuery(ctx.session, "village_id", {
    ...(villageId ? { eq: { village_id: villageId } } : {}),
    ...(activeParam === null ? {} : { eq: { active: activeParam !== "false" } }),
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
        hamletId: row.hamlet_id,
        fullName: row.full_name,
        age: ageFrom(row.birth_date),
        birthDate: row.birth_date,
        gender: row.gender,
        phone: row.phone,
        address: row.address,
        latitude: row.latitude,
        longitude: row.longitude,
        livesAlone: row.lives_alone === true,
        mobilityNotes: row.mobility_notes,
        medicalNotes: row.medical_notes,
        evacuationNotes: row.evacuation_notes,
        active: row.active !== false,
        vulnerabilityCount: residentVulns.length,
        vulnerabilityCategories: residentVulns
          .map(vuln => typeMap.get(String(vuln.vulnerability_type_id))?.category)
          .filter(Boolean),
        deviceId: assignmentMap.get(residentId)?.device_id ?? null
      };
    })
  };
}

export async function getResident(ctx: Ctx) {
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

  const hamletId = optionalText(body.hamletId, "Dusun");
  if (hamletId) {
    const hamlet = await ctx.store.one("hamlets", { eq: { id: hamletId } });
    if (!hamlet || String(hamlet.village_id) !== villageId) throw badRequest("Dusun tidak berada di desa tersebut");
  }

  const resident = await ctx.store.insert("residents", {
    village_id: villageId,
    hamlet_id: hamletId,
    full_name: text(body.fullName ?? body.full_name, "Nama lengkap", { max: 160 }),
    birth_date: optionalText(body.birthDate, "Tanggal lahir", 30),
    gender: body.gender ? oneOf(body.gender, GENDERS, "Jenis kelamin") : null,
    phone: optionalText(body.phone, "Telepon", 40),
    address: optionalText(body.address, "Alamat", 500),
    latitude,
    longitude,
    lives_alone: Boolean(body.livesAlone),
    mobility_notes: optionalText(body.mobilityNotes, "Catatan mobilitas", 500),
    communication_notes: optionalText(body.communicationNotes, "Catatan komunikasi", 500),
    medical_notes: optionalText(body.medicalNotes, "Catatan medis", 500),
    evacuation_notes: optionalText(body.evacuationNotes, "Catatan evakuasi", 500),
    active: true,
    consented_at: nowIso(),
    created_at: nowIso(),
    updated_at: nowIso()
  });
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
  if (body.birthDate !== undefined) patch.birth_date = optionalText(body.birthDate, "Tanggal lahir", 30);
  if (body.gender !== undefined) patch.gender = body.gender ? oneOf(body.gender, GENDERS, "Jenis kelamin") : null;
  if (body.phone !== undefined) patch.phone = optionalText(body.phone, "Telepon", 40);
  if (body.address !== undefined) patch.address = optionalText(body.address, "Alamat", 500);
  if (body.livesAlone !== undefined) patch.lives_alone = Boolean(body.livesAlone);
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
    const open = await ctx.store.list("incidents", { eq: { resident_id: param(ctx, "id") } });
    if (open.some(incident => !["SAFE", "CANCELLED", "CLOSED"].includes(String(incident.status)))) {
      throw conflict("Masih ada insiden aktif. Tutup insiden sebelum menghapus warga secara permanen");
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
  const resident = await ctx.store.one("residents", { eq: { id: param(ctx, "id") } });
  if (!resident) throw notFound("Warga tidak ditemukan");
  assertVillageAccess(ctx.session, resident.village_id);
  const items = Array.isArray(ctx.body.vulnerabilities) ? ctx.body.vulnerabilities : [];
  if (!items.length) throw badRequest("Kirim minimal satu kelompok rentan");
  if (items.length > 20) throw badRequest("Maksimal 20 kelompok rentan per warga");

  const typeIds = items.map(item => requireUuid(item.vulnerabilityTypeId ?? item.vulnerability_type_id, "Jenis kerentanan"));
  const types = await ctx.store.list("vulnerability_types", { in: { id: typeIds } });
  const typeMap = indexBy(types, row => String(row.id));
  const missing = typeIds.filter(id => !typeMap.has(id));
  if (missing.length) throw badRequest("Jenis kerentanan tidak dikenal", { missing });

  await ctx.store.removeWhere("resident_vulnerabilities", { eq: { resident_id: param(ctx, "id") } });
  const rows = items.map((item, index) => {
    const typeId = requireUuid(item.vulnerabilityTypeId ?? item.vulnerability_type_id, "Jenis kerentanan");
    const severity = item.severity === undefined ? 3 : Math.min(5, Math.max(1, Number(item.severity) || 3));
    return {
      resident_id: param(ctx, "id"),
      vulnerability_type_id: typeId,
      severity,
      assistance_notes: optionalText(item.assistanceNotes ?? item.assistance_notes, "Catatan bantuan", 500),
      verified_by: ctx.session.profileId,
      verified_at: nowIso(),
      _sort: index
    };
  });
  const saved = await ctx.store.upsert("resident_vulnerabilities", rows, ["resident_id", "vulnerability_type_id"]);
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "RESIDENT_VULNERABILITY_SET", entityType: "residents",
    entityId: param(ctx, "id"), summary: `Memperbarui ${rows.length} kelompok rentan untuk ${resident.full_name}`
  });
  publish("resident.updated", { id: param(ctx, "id"), full_name: resident.full_name }, String(resident.village_id));
  return saved.map((row, index) => ({ ...row, type: typeMap.get(String(rows[index]?.vulnerability_type_id)) ?? null }));
}

export async function addContact(ctx: Ctx) {
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
  const contact = await ctx.store.one("resident_contacts", { eq: { id: param(ctx, "contactId") } });
  if (!contact) throw notFound("Kontak tidak ditemukan");
  const resident = await ctx.store.one("residents", { eq: { id: String(contact.resident_id) } });
  if (resident) assertVillageAccess(ctx.session, resident.village_id);
  await ctx.store.remove("resident_contacts", param(ctx, "contactId"));
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "RESIDENT_CONTACT_REMOVE", entityType: "residents",
    entityId: String(contact.resident_id), summary: `Menghapus kontak ${contact.name}`
  });
  return { deleted: true };
}
