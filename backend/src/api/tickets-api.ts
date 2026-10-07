import { record } from "../audit.js";
import { assertVillageAccess, requireRole, scopeIds } from "../auth.js";
import { badRequest, clean, indexBy, isUuid, notFound, nowIso, oneOf, optionalText, text } from "../lib.js";
import { publish } from "../realtime.js";
import { param, type Ctx } from "../router.js";
import type { Row } from "../types.js";

/**
 * Kendala teknis: hal yang tidak dapat diselesaikan Desa atau Rescue dan hanya bisa ditangani JAGA Pusat
 * (kalung rusak atau habis, gateway, akun, data wilayah, aplikasi). Siaga/Waspada dan penanganan insiden tetap
 * di Desa dan Rescue; Pusat tidak menerimanya sebagai kendala.
 */
const CATEGORIES = ["KALUNG", "GATEWAY", "AKUN", "DATA", "APLIKASI", "LAINNYA"] as const;
const PRIORITIES = ["RENDAH", "SEDANG", "TINGGI"] as const;
const STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED"] as const;

const shape = (row: Row, villageName: string | null) => ({
  id: row.id,
  villageId: row.village_id ?? null,
  villageName,
  organizationId: row.organization_id ?? null,
  reporterName: row.reporter_name ?? null,
  reporterRole: row.reporter_role,
  category: row.category,
  priority: row.priority,
  title: row.title,
  description: row.description ?? null,
  status: row.status,
  resolutionNote: row.resolution_note ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at ?? row.created_at,
  resolvedAt: row.resolved_at ?? null
});

const visibleTo = (ctx: Ctx, row: Row): boolean => {
  if (ctx.session.role === "PUSAT") return true;
  if (ctx.session.role === "RESCUE") return Boolean(ctx.session.organizationId) && String(row.organization_id ?? "") === ctx.session.organizationId;
  const ids = scopeIds(ctx.session) ?? [];
  return Boolean(row.village_id) && ids.includes(String(row.village_id));
};

export async function listTickets(ctx: Ctx) {
  const status = clean(ctx.query.get("status")).toUpperCase();
  const rows = (await ctx.store.list("support_tickets", { order: { created_at: "desc" } }))
    .filter(row => visibleTo(ctx, row))
    .filter(row => !status || String(row.status) === status);
  const villageIds = Array.from(new Set(rows.map(row => String(row.village_id ?? "")).filter(Boolean)));
  const villages = villageIds.length ? await ctx.store.list("villages", { in: { id: villageIds } }) : [];
  const names = indexBy(villages, row => String(row.id));
  return rows.map(row => shape(row, row.village_id ? String(names.get(String(row.village_id))?.name ?? "") || null : null));
}

export async function createTicket(ctx: Ctx) {
  requireRole(ctx.session, ["DESA", "RESCUE"], "Kendala teknis dilaporkan oleh JAGA Desa atau JAGA Rescue");
  const ids = scopeIds(ctx.session) ?? [];
  let villageId: string | null = clean(ctx.body.villageId) || (ctx.session.role === "DESA" && ids.length === 1 ? ids[0] : "") || null;
  if (villageId) {
    if (!isUuid(villageId)) throw badRequest("Desa tidak valid");
    assertVillageAccess(ctx.session, villageId);
  } else if (ctx.session.role === "DESA") {
    throw badRequest("villageId wajib diisi");
  }
  const row = await ctx.store.insert("support_tickets", {
    village_id: villageId,
    organization_id: ctx.session.organizationId ?? null,
    reporter_id: isUuid(ctx.session.profileId) ? ctx.session.profileId : null,
    reporter_role: ctx.session.role,
    reporter_name: ctx.session.displayName ?? null,
    category: oneOf(ctx.body.category ?? "LAINNYA", CATEGORIES, "Kategori"),
    priority: oneOf(ctx.body.priority ?? "SEDANG", PRIORITIES, "Prioritas"),
    title: text(ctx.body.title, "Judul", { min: 5, max: 160 }),
    description: optionalText(ctx.body.description, "Uraian", 2000),
    status: "OPEN",
    created_at: nowIso(),
    updated_at: nowIso()
  });
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "TICKET_CREATE", entityType: "support_tickets",
    entityId: String(row.id), summary: `Kendala teknis: ${row.title}`
  });
  publish("ticket.created", { id: row.id, category: row.category, priority: row.priority }, villageId ?? undefined);
  const village = villageId ? await ctx.store.one("villages", { eq: { id: villageId } }) : null;
  return shape(row, village ? String(village.name) : null);
}

export async function updateTicket(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT"], "Hanya JAGA Pusat yang dapat menangani kendala teknis");
  const ticket = await ctx.store.one("support_tickets", { eq: { id: param(ctx, "id") } });
  if (!ticket) throw notFound("Kendala tidak ditemukan");
  const patch: Row = { updated_at: nowIso() };
  if (ctx.body.status !== undefined) {
    patch.status = oneOf(ctx.body.status, STATUSES, "Status");
    patch.resolved_at = patch.status === "RESOLVED" ? nowIso() : null;
  }
  if (ctx.body.priority !== undefined) patch.priority = oneOf(ctx.body.priority, PRIORITIES, "Prioritas");
  if (ctx.body.resolutionNote !== undefined) patch.resolution_note = optionalText(ctx.body.resolutionNote, "Catatan penanganan", 1000);
  if (patch.status === "RESOLVED" && !(patch.resolution_note ?? ticket.resolution_note)) {
    throw badRequest("Catatan penanganan wajib diisi saat kendala diselesaikan");
  }
  const updated = await ctx.store.update("support_tickets", String(ticket.id), patch);
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "TICKET_UPDATE", entityType: "support_tickets",
    entityId: String(ticket.id), summary: `Kendala ${ticket.title}: ${patch.status ?? "diperbarui"}`
  });
  publish("ticket.updated", { id: ticket.id, status: patch.status ?? ticket.status }, ticket.village_id ?? undefined);
  const village = ticket.village_id ? await ctx.store.one("villages", { eq: { id: String(ticket.village_id) } }) : null;
  return shape(updated ?? { ...ticket, ...patch }, village ? String(village.name) : null);
}
