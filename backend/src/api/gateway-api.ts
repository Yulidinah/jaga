import { actorOf, record } from "../audit.js";
import { authenticateGateway } from "../auth.js";
import { badRequest, forbidden, indexBy, nowIso } from "../lib.js";
import type { Ctx } from "../router.js";
import type { Row, Session } from "../types.js";
import { acknowledgeAlert, activeAlarmFor, refreshCommandStatus } from "./alerts-api.js";
import { deviceSos, ingestTelemetry, mediaFor } from "./devices-api.js";

/**
 * Jembatan untuk gateway desa (SRS bagian 3): LoRa di sisi desa, HTTPS di sisi server.
 * - GET  /api/gateway/outbox : alarm yang menunggu untuk diteruskan lewat LoRa ke kalung desa ini.
 * - POST /api/gateway/ingest : unggahan massal (store-and-forward) berisi telemetri, tombol bantuan, dan konfirmasi alarm.
 * Autentikasi cukup kunci gateway (X-JAGA-Gateway-Key); gateway hanya boleh memegang perangkat di desanya sendiri.
 */
const MAX_EVENTS = 200;

async function gatewayOf(ctx: Ctx): Promise<{ gateway: Row; villageId: string; session: Session }> {
  const { gateway } = await authenticateGateway(ctx.store, ctx.req, ctx.url);
  if (!gateway.village_id) throw forbidden("Gateway belum terikat pada desa");
  const villageId = String(gateway.village_id);
  await ctx.store.update("gateways", String(gateway.id), { last_seen_at: nowIso(), online: true, updated_at: nowIso() });
  const session: Session = {
    userId: `gateway:${gateway.id}`, profileId: `gateway:${gateway.id}`, displayName: String(gateway.name ?? "Gateway"), email: "", role: "RESCUE",
    organizationId: null, organizationName: null, villageIds: [villageId], villageNames: [], authSource: "internal", expiresAt: Date.now() + 60_000
  };
  return { gateway, villageId, session };
}

export async function gatewayOutbox(ctx: Ctx) {
  const { gateway, villageId } = await gatewayOf(ctx);
  const devices = await ctx.store.list("devices", { eq: { village_id: villageId } });
  const deviceIds = devices.map(row => String(row.id));
  const receipts = deviceIds.length ? await ctx.store.list("command_receipts", { in: { device_id: deviceIds, status: ["QUEUED", "SENT"] } }) : [];
  const commands = receipts.length ? await ctx.store.list("alert_commands", { in: { id: Array.from(new Set(receipts.map(row => String(row.command_id)))) } }) : [];
  const commandOf = indexBy(commands, row => String(row.id));
  const now = nowIso();
  const grouped = new Map<string, { command: Row; targets: Array<{ deviceId: string; receiptId: string }> }>();
  const touched = new Set<string>();
  for (const receipt of receipts) {
    const command = commandOf.get(String(receipt.command_id));
    if (!command || (command.expires_at && String(command.expires_at) <= now) || ["EXPIRED", "FAILED"].includes(String(command.status))) continue;
    const entry = grouped.get(String(command.id)) ?? { command, targets: [] };
    entry.targets.push({ deviceId: String(receipt.device_id), receiptId: String(receipt.id) });
    grouped.set(String(command.id), entry);
    if (String(receipt.status) === "QUEUED") {
      await ctx.store.update("command_receipts", String(receipt.id), { status: "SENT", sent_at: nowIso() });
      touched.add(String(command.id));
    }
  }
  for (const commandId of touched) await refreshCommandStatus(ctx, commandId);

  // Perangkat yang tombolnya harus terbuka (alarm aktif); gateway meneruskannya lewat LoRa.
  const unlocked: string[] = [];
  for (const id of deviceIds) if (await activeAlarmFor(ctx.store, id)) unlocked.push(id);
  return {
    gatewayId: gateway.id,
    villageId,
    serverTime: nowIso(),
    commands: Array.from(grouped.values()).map(({ command, targets }) => ({
      id: command.id, severity: command.severity, media: mediaFor(String(command.severity)), message: command.message,
      createdAt: command.created_at, expiresAt: command.expires_at, targets
    })),
    unlockedDevices: unlocked,
    nextPollSeconds: grouped.size || unlocked.length ? 15 : 120
  };
}

export async function gatewayIngest(ctx: Ctx) {
  const { gateway, villageId, session } = await gatewayOf(ctx);
  const events = Array.isArray(ctx.body.events) ? ctx.body.events : null;
  if (!events) throw badRequest("Kirim { \"events\": [ ... ] }");
  if (events.length > MAX_EVENTS) throw badRequest(`Maksimal ${MAX_EVENTS} kejadian per unggahan`);

  const results: Array<Row> = [];
  for (const [index, raw] of events.entries()) {
    const event = (raw && typeof raw === "object" ? raw : {}) as Row;
    const type = String(event.type ?? "");
    try {
      let deviceId = String(event.deviceId ?? "");
      if (type === "receipt") {
        const receipt = await ctx.store.one("command_receipts", { eq: { id: String(event.receiptId ?? "") } });
        if (!receipt) throw badRequest("receiptId tidak dikenal");
        deviceId = String(receipt.device_id);
      }
      const device = await ctx.store.one("devices", { eq: { id: deviceId } });
      if (!device || String(device.village_id) !== villageId) throw forbidden("Perangkat tidak terdaftar di desa gateway ini");
      if (["LOST", "RETIRED"].includes(String(device.status))) throw forbidden("Perangkat berstatus hilang atau dipensiunkan");
      const assignment = await ctx.store.one("device_assignments", { eq: { device_id: String(device.id) }, isNull: { unassigned_at: true } });
      const base: Ctx = {
        ...ctx, session, device, deviceAuth: { device, residentId: assignment?.resident_id ? String(assignment.resident_id) : null },
        gateway: { gateway }, body: event, params: {}
      };
      if (type === "telemetry") {
        await ingestTelemetry(base);
      } else if (type === "assist") {
        const out = await deviceSos(base) as Row;
        results.push({ index, type, ok: true, incidentId: out.incidentId, duplicate: out.duplicate });
        continue;
      } else if (type === "receipt") {
        await acknowledgeAlert({ ...base, params: { receiptId: String(event.receiptId) }, body: { status: event.status ?? "ACKNOWLEDGED", reason: event.reason } });
      } else {
        throw badRequest("type harus telemetry, assist, atau receipt");
      }
      results.push({ index, type, ok: true });
    } catch (error) {
      results.push({ index, type, ok: false, error: (error as Error).message });
    }
  }
  const accepted = results.filter(row => row.ok).length;
  await record(ctx.store, {
    actorId: actorOf(session), action: "GATEWAY_INGEST", entityType: "gateways", entityId: String(gateway.id),
    summary: `Gateway ${gateway.gateway_code ?? gateway.id}: ${accepted}/${events.length} kejadian diterima`
  });
  return { received: events.length, accepted, rejected: events.length - accepted, results };
}
