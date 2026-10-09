import { createRequire } from "node:module";
import { actorOf, record } from "../audit.js";
import { assertVillageAccess, requireRole, scopeIds } from "../auth.js";
import { config } from "../config.js";
import { badRequest, clean, forbidden, indexBy, isOnline, isUuid, notFound, nowIso, oneOf, optionalText, text } from "../lib.js";
import { publish } from "../realtime.js";
import { param, type Ctx } from "../router.js";
import type { Store } from "../store.js";
import type { Row } from "../types.js";
import { scopedQuery } from "./common.js";

const require = createRequire(import.meta.url);
const APP_VERSION: string = (() => { try { return String(require("../../../package.json").version); } catch { return "tidak diketahui"; } })();

/* ============================================================ Pengaturan platform (SRS FR-1.5, FR-1.6) */

export interface PlatformSettings {
  device_offline_minutes: number;
  alert_expiry_minutes: number;
  rescue_view_medical: boolean;
  rescue_view_contacts: boolean;
  rescue_view_gps: boolean;
}
const DEFAULTS: PlatformSettings = {
  device_offline_minutes: config.deviceOfflineMinutes,
  alert_expiry_minutes: 120,
  rescue_view_medical: true,
  rescue_view_contacts: true,
  rescue_view_gps: true
};
let cache: { at: number; value: PlatformSettings } | null = null;

export async function getSettings(store: Store): Promise<PlatformSettings> {
  if (cache && Date.now() - cache.at < 5_000) return cache.value;
  const merged: Row = { ...DEFAULTS };
  try {
    for (const row of await store.list("platform_settings", {})) if (String(row.key) in DEFAULTS) merged[String(row.key)] = row.value;
  } catch { /* tabel belum ada: pakai bawaan */ }
  cache = { at: Date.now(), value: merged as unknown as PlatformSettings };
  return cache.value;
}

/** Menerapkan pengaturan yang memengaruhi modul lain (ambang offline kalung). Dipanggil saat server mulai dan setelah pengaturan berubah. */
export async function applyPlatformSettings(store: Store): Promise<void> {
  cache = null;
  const settings = await getSettings(store);
  (config as unknown as { deviceOfflineMinutes: number }).deviceOfflineMinutes = settings.device_offline_minutes;
}

const validators: Record<keyof PlatformSettings, (value: unknown) => unknown> = {
  device_offline_minutes: v => { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 1440) throw badRequest("device_offline_minutes harus bilangan bulat 1 sampai 1440"); return n; },
  alert_expiry_minutes: v => { const n = Number(v); if (!Number.isInteger(n) || n < 5 || n > 10080) throw badRequest("alert_expiry_minutes harus bilangan bulat 5 sampai 10080"); return n; },
  rescue_view_medical: v => Boolean(v),
  rescue_view_contacts: v => Boolean(v),
  rescue_view_gps: v => Boolean(v)
};

export async function getPlatform(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT"], "Pengaturan platform hanya untuk JAGA Pusat");
  const settings = await getSettings(ctx.store);
  const devices = await ctx.store.list("devices", {});
  const versions = new Map<string, number>();
  for (const device of devices) {
    const key = String(device.firmware_version ?? "tidak diketahui");
    versions.set(key, (versions.get(key) ?? 0) + 1);
  }
  return {
    settings,
    defaults: DEFAULTS,
    version: { app: APP_VERSION, node: process.version, storage: ctx.store.kind },
    firmware: Array.from(versions.entries()).map(([version, count]) => ({ version, count })).sort((a, b) => b.count - a.count)
  };
}

export async function savePlatform(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT"], "Pengaturan platform hanya untuk JAGA Pusat");
  const input = (ctx.body.settings && typeof ctx.body.settings === "object" ? ctx.body.settings : ctx.body) as Row;
  const changed: Row = {};
  for (const key of Object.keys(DEFAULTS) as Array<keyof PlatformSettings>) {
    if (input[key] === undefined) continue;
    changed[key] = validators[key](input[key]);
  }
  if (!Object.keys(changed).length) throw badRequest("Tidak ada pengaturan yang dikirim");
  for (const [key, value] of Object.entries(changed)) {
    await ctx.store.upsert("platform_settings", [{ key, value, updated_by: actorOf(ctx.session), updated_at: nowIso() }], ["key"]);
  }
  await applyPlatformSettings(ctx.store);
  await record(ctx.store, {
    actorId: actorOf(ctx.session), action: "PLATFORM_SETTINGS", entityType: "platform_settings", entityId: null,
    summary: `Pengaturan platform: ${Object.entries(changed).map(([k, v]) => `${k}=${v}`).join(", ")}`
  });
  return getPlatform(ctx);
}

/** Panel tata kelola data sensitif (FR-1.6): siapa melihat apa, persetujuan, dan akses Rescue ke data warga. */
export async function governance(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT"], "Tata kelola data hanya untuk JAGA Pusat");
  const settings = await getSettings(ctx.store);
  const residents = await ctx.store.list("residents", { eq: { active: true } });
  const since = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
  const audit = (await ctx.store.list("audit_logs", { in: { action: ["RESCUE_RESIDENT_VIEW", "OPERATION_ROSTER_VIEW", "OPERATION_ROUTE_VIEW"] }, order: { created_at: "desc" }, limit: 200 }))
    .filter(row => String(row.created_at) >= since);
  const counts: Record<string, number> = {};
  for (const row of audit) counts[String(row.action)] = (counts[String(row.action)] ?? 0) + 1;
  const yes = "Ya", no = "Tidak", op = "Hanya saat operasi aktif";
  return {
    matrix: [
      { field: "Nama warga", desa: yes, rescue: op, pusat: yes },
      { field: "Alamat umum dan titik rumah", desa: yes, rescue: op, pusat: yes },
      { field: "Posisi GPS kalung langsung", desa: yes, rescue: settings.rescue_view_gps ? op : no, pusat: no },
      { field: "Jenis kerentanan dan kemampuan evakuasi", desa: yes, rescue: op, pusat: yes },
      { field: "Catatan medis dan kebutuhan penanganan", desa: yes, rescue: settings.rescue_view_medical ? op : no, pusat: no },
      { field: "Kontak darurat", desa: yes, rescue: settings.rescue_view_contacts ? op : no, pusat: no },
      { field: "NIK dan identitas resmi", desa: no, rescue: no, pusat: "Tidak tersedia di antarmuka (jalur kemitraan Dinsos/BPS)" }
    ],
    consent: { total: residents.length, consented: residents.filter(row => row.consented_at).length },
    nikStored: residents.filter(row => row.national_id_encrypted).length,
    rescueAccess30d: counts,
    recentAccess: audit.slice(0, 10).map(row => ({ at: row.created_at, action: row.action, summary: row.summary })),
    settings
  };
}

/* ============================================================ Pengumuman Pusat (FR-1.7) */

const shapeAnnouncement = (row: Row) => ({
  id: row.id, sourceRole: row.source_role ?? "PUSAT", title: row.title, body: row.body, priority: row.priority, createdAt: row.created_at, expiresAt: row.expires_at ?? null, createdBy: row.created_by_name ?? null,
  villageIds: Array.isArray(row.village_ids) && (row.village_ids as unknown[]).length ? (row.village_ids as unknown[]).map(String) : null
});

export async function listAnnouncements(ctx: Ctx) {
  const rows = await ctx.store.list("announcements", { order: { created_at: "desc" }, limit: 100 });
  const scope = scopeIds(ctx.session);
  const now = nowIso();
  return rows
    .filter(row => ctx.session.role === "PUSAT" || !row.expires_at || String(row.expires_at) > now)
    .filter(row => scope === null || !Array.isArray(row.village_ids) || !(row.village_ids as unknown[]).length || (row.village_ids as unknown[]).some(id => scope.includes(String(id))))
    .map(shapeAnnouncement);
}

export async function createAnnouncement(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT", "DESA"], "Hanya JAGA Pusat dan JAGA Desa yang dapat mengirim pengumuman");
  const fromDesa = ctx.session.role === "DESA";
  const hours = Number(ctx.body.expiresInHours ?? 72);
  if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 90) throw badRequest("expiresInHours harus 1 sampai 2160");
  // Pesan Desa selalu ditujukan ke JAGA Rescue di desanya sendiri; tujuan lain diabaikan.
  const rawIds = fromDesa ? [ctx.session.villageIds?.[0] ?? ""] : Array.isArray(ctx.body.villageIds) ? ctx.body.villageIds : [];
  const villageIds = Array.from(new Set(rawIds.map(clean).filter(Boolean)));
  if (fromDesa) {
    if (!villageIds.length) throw badRequest("Akun Desa belum terhubung ke desa");
    assertVillageAccess(ctx.session, villageIds[0]);
  }
  if (villageIds.length && villageIds.some(id => !isUuid(id))) throw badRequest("villageIds harus berisi ID desa berbentuk UUID");
  if (villageIds.length > 200) throw badRequest("Maksimal 200 desa per pengumuman");
  if (villageIds.length) {
    const known = await ctx.store.list("villages", { in: { id: villageIds } });
    if (known.length !== villageIds.length) throw badRequest("Ada ID desa tujuan yang tidak dikenal");
  }
  const row = await ctx.store.insert("announcements", {
    title: text(ctx.body.title, "Judul", { min: 3, max: 160 }),
    body: text(ctx.body.body, "Isi pengumuman", { min: 3, max: 2000 }),
    priority: oneOf(ctx.body.priority ?? "INFO", ["INFO", "PENTING"] as const, "Prioritas"),
    created_by: actorOf(ctx.session),
    created_by_name: ctx.session.displayName ?? null,
    created_at: nowIso(),
    expires_at: new Date(Date.now() + hours * 3_600_000).toISOString(),
    village_ids: villageIds.length ? villageIds : null,
    source_role: fromDesa ? "DESA" : "PUSAT"
  });
  await record(ctx.store, { actorId: actorOf(ctx.session), action: "ANNOUNCEMENT_CREATE", entityType: "announcements", entityId: String(row.id), summary: fromDesa ? `Pesan Desa untuk Rescue: ${row.title}` : `Pengumuman: ${row.title}${villageIds.length ? ` untuk ${villageIds.length} desa` : " untuk semua desa"}` });
  publish("announcement.created", { id: row.id, title: row.title, priority: row.priority, sourceRole: row.source_role }, fromDesa ? villageIds[0] : undefined);
  return shapeAnnouncement(row);
}

export async function deleteAnnouncement(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT", "DESA"]);
  const row = await ctx.store.one("announcements", { eq: { id: param(ctx, "id") } });
  if (!row) throw notFound("Pengumuman tidak ditemukan");
  if (ctx.session.role === "DESA") {
    // Desa hanya menghapus pesannya sendiri, bukan pengumuman Pusat.
    if (row.source_role !== "DESA") throw forbidden("Pengumuman Pusat hanya dapat dihapus JAGA Pusat");
    assertVillageAccess(ctx.session, (row.village_ids as unknown[] | null)?.[0]);
  }
  await ctx.store.remove("announcements", String(row.id));
  await record(ctx.store, { actorId: actorOf(ctx.session), action: "ANNOUNCEMENT_DELETE", entityType: "announcements", entityId: String(row.id), summary: `Menghapus pengumuman ${row.title}` });
  return { id: row.id, deleted: true };
}

/* ============================================================ Status desa dan hasil evakuasi (FR-1.2, FR-1.3) */

const OUTCOME_KEYS = ["EVACUATED", "SAFE", "NOT_FOUND", "UNREACHABLE"] as const;

/** Rekap hasil penanganan insiden dalam lingkup sesi. */
export async function outcomes(store: Store, rows: Row[]) {
  const result: Record<string, number> = { EVACUATED: 0, SAFE: 0, NOT_FOUND: 0, UNREACHABLE: 0, OPEN: 0 };
  const add = (key: string) => { result[key] = (result[key] ?? 0) + 1; };
  for (const row of rows) {
    const status = String(row.status);
    if ((OUTCOME_KEYS as readonly string[]).includes(status)) add(status);
    else if (!["CANCELLED", "CLOSED"].includes(status)) add("OPEN");
  }
  void store;
  return result;
}

/** Desa aktif atau tidak, dan waktu sinkron terakhir dari gateway atau kalung. */
export async function villageStatus(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT"], "Status sinkron desa untuk JAGA Pusat");
  const [villages, gateways, devices] = await Promise.all([
    ctx.store.list("villages", {}), ctx.store.list("gateways", {}), ctx.store.list("devices", {})
  ]);
  const inactiveAfterHours = 24;
  const rows = [];
  for (const village of villages) {
    const id = String(village.id);
    const gw = gateways.filter(row => String(row.village_id) === id);
    const dv = devices.filter(row => String(row.village_id) === id && !["STOCK", "RETIRED", "LOST"].includes(String(row.status)));
    const stamps = [...gw, ...dv].map(row => String(row.last_seen_at ?? "")).filter(Boolean).sort();
    const lastSyncAt = stamps[stamps.length - 1] ?? null;
    const active = Boolean(lastSyncAt) && Date.now() - new Date(lastSyncAt as string).getTime() <= inactiveAfterHours * 3_600_000;
    rows.push({
      villageId: id, name: village.name, province: village.province ?? null, regency: village.regency ?? null,
      status: active ? "ACTIVE" : "INACTIVE", lastSyncAt,
      gateways: { online: gw.filter(row => isOnline(row)).length, total: gw.length },
      devices: { online: dv.filter(row => isOnline(row)).length, total: dv.length }
    });
  }
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name), "id"));
  return { inactiveAfterHours, villages: rows };
}

/* ============================================================ Laporan pasca-operasi Rescue (FR-3.9) */

const shapeReport = (row: Row, extra: { villageName?: string | null; operationOpenedAt?: string | null }) => ({
  id: row.id, operationId: row.operation_id, villageId: row.village_id ?? null, villageName: extra.villageName ?? null,
  organizationId: row.organization_id ?? null, organizationName: row.organization_name ?? null, teamName: row.team_name ?? null,
  authorName: row.author_name ?? null, summary: row.summary,
  foundCount: row.found_count ?? 0, evacuatedCount: row.evacuated_count ?? 0, notFoundCount: row.not_found_count ?? 0, unreachableCount: row.unreachable_count ?? 0,
  distanceKm: row.distance_km ?? null, createdAt: row.created_at, operationOpenedAt: extra.operationOpenedAt ?? null
});

export async function createReport(ctx: Ctx) {
  requireRole(ctx.session, ["RESCUE"], "Laporan pasca-operasi dikirim oleh JAGA Rescue");
  const operation = await ctx.store.one("operations", { eq: { id: param(ctx, "id") } });
  if (!operation) throw notFound("Operasi tidak ditemukan");
  assertVillageAccess(ctx.session, operation.village_id);
  const count = (key: string, label: string) => {
    const n = Number(ctx.body[key] ?? 0);
    if (!Number.isInteger(n) || n < 0 || n > 10000) throw badRequest(`${label} harus bilangan bulat 0 sampai 10000`);
    return n;
  };
  const distance = ctx.body.distanceKm === undefined || ctx.body.distanceKm === "" ? null : Number(ctx.body.distanceKm);
  if (distance !== null && (!Number.isFinite(distance) || distance < 0 || distance > 5000)) throw badRequest("distanceKm tidak valid");
  const teamId = clean(ctx.body.teamId);
  const team = teamId && isUuid(teamId) ? await ctx.store.one("rescue_teams", { eq: { id: teamId } }) : null;
  const organization = ctx.session.organizationId ? await ctx.store.one("organizations", { eq: { id: ctx.session.organizationId } }) : null;
  const row = await ctx.store.insert("operation_reports", {
    operation_id: String(operation.id), village_id: String(operation.village_id), organization_id: ctx.session.organizationId ?? null,
    organization_name: organization?.name ?? null, team_name: team?.name ?? null, author_id: actorOf(ctx.session), author_name: ctx.session.displayName ?? null,
    summary: text(ctx.body.summary, "Ringkasan", { min: 10, max: 4000 }),
    found_count: count("foundCount", "Jumlah ditemukan"), evacuated_count: count("evacuatedCount", "Jumlah dievakuasi"),
    not_found_count: count("notFoundCount", "Jumlah tidak ditemukan"), unreachable_count: count("unreachableCount", "Jumlah tidak terjangkau"),
    distance_km: distance, created_at: nowIso()
  });
  await record(ctx.store, { actorId: actorOf(ctx.session), action: "OPERATION_REPORT", entityType: "operations", entityId: String(operation.id), summary: `Laporan pasca-operasi dari ${organization?.name ?? "Rescue"}` });
  const village = await ctx.store.one("villages", { eq: { id: String(operation.village_id) } });
  publish("operation.updated", { id: operation.id, report: true }, String(operation.village_id));
  return shapeReport(row, { villageName: village?.name ?? null, operationOpenedAt: operation.opened_at ?? null });
}

export async function listReports(ctx: Ctx) {
  const rows = await ctx.store.list("operation_reports", scopedQuery(ctx.session, "village_id", { order: { created_at: "desc" }, limit: 200 }));
  const visible = ctx.session.role === "RESCUE" ? rows.filter(row => String(row.organization_id ?? "") === String(ctx.session.organizationId ?? "")) : rows;
  const villageIds = Array.from(new Set(visible.map(row => String(row.village_id)).filter(Boolean)));
  const villages = villageIds.length ? await ctx.store.list("villages", { in: { id: villageIds } }) : [];
  const names = indexBy(villages, row => String(row.id));
  const opIds = Array.from(new Set(visible.map(row => String(row.operation_id))));
  const ops = opIds.length ? await ctx.store.list("operations", { in: { id: opIds } }) : [];
  const opOf = indexBy(ops, row => String(row.id));
  return visible.map(row => shapeReport(row, { villageName: names.get(String(row.village_id))?.name ?? null, operationOpenedAt: opOf.get(String(row.operation_id))?.opened_at ?? null }));
}

/* ============================================================ Jejak dan cakupan tim (FR-3.5, FR-3.7) */

/** Jejak seluruh tim yang melayani desa operasi: untuk menandai area yang sudah disisir dan koordinasi antar tim. */
export async function operationCoverage(ctx: Ctx) {
  const operation = await ctx.store.one("operations", { eq: { id: param(ctx, "id") } });
  if (!operation) throw notFound("Operasi tidak ditemukan");
  assertVillageAccess(ctx.session, operation.village_id);
  const areas = await ctx.store.list("organization_service_areas", { eq: { village_id: String(operation.village_id) } });
  const orgIds = Array.from(new Set(areas.map(row => String(row.organization_id))));
  const teams = orgIds.length ? await ctx.store.list("rescue_teams", { in: { organization_id: orgIds } }) : [];
  const orgs = orgIds.length ? await ctx.store.list("organizations", { in: { id: orgIds } }) : [];
  const orgName = indexBy(orgs, row => String(row.id));
  const since = String(operation.opened_at ?? "");
  const out = [];
  for (const team of teams) {
    const trail = (await ctx.store.list("team_location_history", { eq: { team_id: String(team.id) }, order: { recorded_at: "desc" }, limit: 400 }))
      .filter(row => !since || String(row.recorded_at) >= since)
      .reverse()
      .filter(row => row.latitude !== null && row.latitude !== undefined && row.longitude !== null && row.longitude !== undefined);
    out.push({
      teamId: team.id, name: team.name, organizationName: orgName.get(String(team.organization_id))?.name ?? null, status: team.status,
      latitude: team.latitude ?? null, longitude: team.longitude ?? null, updatedAt: team.updated_at ?? null,
      points: trail.map(row => ({ lat: Number(row.latitude), lng: Number(row.longitude), at: row.recorded_at }))
    });
  }
  return { operationId: operation.id, openedAt: operation.opened_at, teams: out };
}

export const _unused = { optionalText, scopeIds };
