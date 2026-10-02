import { record } from "../audit.js";
import { assertVillageAccess, newDeviceKey, newGatewayKey, requireRole } from "../auth.js";
import { badRequest, clean, conflict, indexBy, notFound, nowIso, oneOf, optionalText, randomToken, requireUuid, sha256Hex, text } from "../lib.js";
import { publish } from "../realtime.js";
import { param, type Ctx } from "../router.js";
import type { DeviceStatus, Row } from "../types.js";
import { eqFilter, parsePaging, scopedQuery } from "./common.js";
import { createSos } from "./incidents-api.js";
import { refreshCommandStatus } from "./alerts-api.js";

const DEVICE_STATUSES: DeviceStatus[] = ["STOCK", "ASSIGNED", "MAINTENANCE", "LOST", "RETIRED"];

/** Koordinat valid dalam rentang, atau null (null/""/NaN tidak dianggap 0). */
const coordinate = (value: unknown, limit: number): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit ? parsed : null;
};

const optionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const deviceShape = (device: Row) => ({
  id: device.id,
  villageId: device.village_id,
  ownerName: device.owner_name,
  hardwareSerial: device.hardware_serial,
  model: device.model,
  firmwareVersion: device.firmware_version,
  status: device.status,
  latitude: device.latitude,
  longitude: device.longitude,
  battery: device.battery,
  online: device.online,
  lastSeenAt: device.last_seen_at,
  hasKey: Boolean(device.auth_key_hash)
});

export async function listDevices(ctx: Ctx) {
  const { limit, offset } = parsePaging(ctx.query, 500);
  const status = clean(ctx.query.get("status"));
  const villageId = clean(ctx.query.get("villageId"));
  const rows = await ctx.store.list("devices", scopedQuery(ctx.session, "village_id", {
    ...eqFilter(status ? { status: status.toUpperCase() } : null, villageId ? { village_id: villageId } : null),
    order: { id: "asc" }
  }));
  const window = rows.slice(offset, offset + limit);
  const assignments = window.length
    ? await ctx.store.list("device_assignments", { in: { device_id: window.map(row => String(row.id)) }, isNull: { unassigned_at: true } })
    : [];
  const residentIds = assignments.map(row => String(row.resident_id));
  const residents = residentIds.length ? await ctx.store.list("residents", { in: { id: residentIds } }) : [];
  const residentMap = indexBy(residents, row => String(row.id));
  const assignmentMap = new Map(assignments.map(row => [String(row.device_id), row]));

  return {
    total: rows.length,
    limit,
    offset,
    data: window.map(device => {
      const assignment = assignmentMap.get(String(device.id)) ?? null;
      return {
        ...deviceShape(device),
        residentId: assignment?.resident_id ?? null,
        residentName: assignment ? residentMap.get(String(assignment.resident_id))?.full_name ?? null : null,
        assignedAt: assignment?.assigned_at ?? null
      };
    })
  };
}

export async function createDevice(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT", "DESA"], "Hanya pusat atau desa yang dapat mendaftarkan perangkat");
  const villageId = requireUuid(ctx.body.villageId, "Desa");
  assertVillageAccess(ctx.session, villageId);
  if (!(await ctx.store.one("villages", { eq: { id: villageId } }))) throw badRequest("Desa tidak ditemukan");
  const deviceId = clean(ctx.body.id) || `JAGA-${randomToken(6).replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase()}`;
  const existing = await ctx.store.one("devices", { eq: { id: deviceId } });
  if (existing) throw conflict("ID perangkat sudah dipakai");
  const latitude = coordinate(ctx.body.latitude, 90);
  const longitude = coordinate(ctx.body.longitude, 180);
  if (latitude === null || longitude === null) throw badRequest("Latitude dan longitude wajib diisi dan berada dalam rentang valid");

  const key = newDeviceKey();
  const device = await ctx.store.insert("devices", {
    id: deviceId,
    village_id: villageId,
    owner_name: optionalText(ctx.body.ownerName, "Nama pemilik", 160) ?? "",
    hardware_serial: optionalText(ctx.body.hardwareSerial, "Nomor seri", 80),
    model: optionalText(ctx.body.model, "Model", 80),
    firmware_version: optionalText(ctx.body.firmwareVersion, "Versi firmware", 40),
    status: "STOCK",
    latitude,
    longitude,
    battery: 100,
    online: false,
    last_seen_at: nowIso(),
    auth_key_hash: sha256Hex(key),
    created_at: nowIso(),
    updated_at: nowIso()
  });
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "DEVICE_CREATE", entityType: "devices",
    entityId: deviceId, summary: `Mendaftarkan perangkat ${deviceId}`, after: device
  });
  return { ...deviceShape(device), deviceKey: key, note: "Kunci hanya ditampilkan sekali. Simpan di perangkat." };
}

export async function updateDevice(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT", "DESA"]);
  const device = await ctx.store.one("devices", { eq: { id: param(ctx, "id") } });
  if (!device) throw notFound("Perangkat tidak ditemukan");
  assertVillageAccess(ctx.session, device.village_id, "Perangkat di luar kewenangan Anda");
  const patch: Row = { updated_at: nowIso() };
  if (ctx.body.model !== undefined) patch.model = optionalText(ctx.body.model, "Model", 80);
  if (ctx.body.firmwareVersion !== undefined) patch.firmware_version = optionalText(ctx.body.firmwareVersion, "Firmware", 40);
  if (ctx.body.notes !== undefined) patch.notes = optionalText(ctx.body.notes, "Catatan", 500);
  if (ctx.body.status !== undefined) patch.status = oneOf(ctx.body.status, DEVICE_STATUSES, "Status perangkat");
  const updated = await ctx.store.update("devices", param(ctx, "id"), patch);
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "DEVICE_UPDATE", entityType: "devices",
    entityId: param(ctx, "id"), summary: "Memperbarui perangkat", before: device, after: updated
  });
  return deviceShape(updated ?? device);
}

export async function assignDevice(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT", "DESA"]);
  const device = await ctx.store.one("devices", { eq: { id: param(ctx, "id") } });
  if (!device) throw notFound("Perangkat tidak ditemukan");
  assertVillageAccess(ctx.session, device.village_id, "Perangkat di luar kewenangan Anda");
  const residentId = clean(ctx.body.residentId);
  const resident = await ctx.store.one("residents", { eq: { id: residentId } });
  if (!resident) throw badRequest("Warga tidak ditemukan");
  assertVillageAccess(ctx.session, resident.village_id, "Warga berada di luar kewenangan Anda");
  if (String(resident.village_id) !== String(device.village_id)) {
    throw badRequest("Perangkat hanya boleh dipasang pada warga di desa yang sama");
  }
  const busy = await ctx.store.one("device_assignments", { eq: { device_id: param(ctx, "id") }, isNull: { unassigned_at: true } });
  if (busy) await ctx.store.update("device_assignments", String(busy.id), { unassigned_at: nowIso() });
  const otherDevice = await ctx.store.one("device_assignments", { eq: { resident_id: residentId }, isNull: { unassigned_at: true } });
  if (otherDevice) await ctx.store.update("device_assignments", String(otherDevice.id), { unassigned_at: nowIso() });

  const assignment = await ctx.store.insert("device_assignments", {
    device_id: param(ctx, "id"),
    resident_id: residentId,
    assigned_by: ctx.session.profileId,
    assigned_at: nowIso(),
    notes: optionalText(ctx.body.notes, "Catatan", 500)
  });
  await ctx.store.update("devices", param(ctx, "id"), { status: "ASSIGNED", owner_name: String(resident.full_name), updated_at: nowIso() });
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "DEVICE_ASSIGN", entityType: "devices",
    entityId: param(ctx, "id"), summary: `Memasang perangkat ke ${resident.full_name}`, after: assignment
  });
  return assignment;
}

export async function unassignDevice(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT", "DESA"]);
  const assignment = await ctx.store.one("device_assignments", { eq: { device_id: param(ctx, "id") }, isNull: { unassigned_at: true } });
  if (!assignment) throw notFound("Perangkat tidak sedang terpasang");
  await ctx.store.update("device_assignments", String(assignment.id), { unassigned_at: nowIso() });
  await ctx.store.update("devices", param(ctx, "id"), { status: "STOCK", owner_name: "", updated_at: nowIso() });
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "DEVICE_UNASSIGN", entityType: "devices",
    entityId: param(ctx, "id"), summary: "Melepas perangkat dari warga"
  });
  return { removed: true };
}

export async function deviceTelemetry(ctx: Ctx) {
  const limit = Math.min(500, Math.max(1, Number(ctx.query.get("limit") ?? 50) || 50));
  const device = await ctx.store.one("devices", { eq: { id: param(ctx, "id") } });
  if (!device) throw notFound("Perangkat tidak ditemukan");
  assertVillageAccess(ctx.session, device.village_id);
  const rows = await ctx.store.list("device_telemetry", { eq: { device_id: param(ctx, "id") }, order: { recorded_at: "desc" }, limit });
  return { device: deviceShape(device), telemetry: rows };
}

export async function rotateDeviceKey(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT", "DESA"]);
  const device = await ctx.store.one("devices", { eq: { id: param(ctx, "id") } });
  if (!device) throw notFound("Perangkat tidak ditemukan");
  assertVillageAccess(ctx.session, device.village_id, "Perangkat di luar kewenangan Anda");
  const key = newDeviceKey();
  await ctx.store.update("devices", param(ctx, "id"), { auth_key_hash: sha256Hex(key), updated_at: nowIso() });
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "DEVICE_KEY_ROTATE", entityType: "devices",
    entityId: param(ctx, "id"), summary: `Rotasi kunci ${device.id}`
  });
  return { deviceId: device.id, deviceKey: key, note: "Kunci lama langsung tidak berlaku." };
}

/* --------------------------------------------------------------- Gateway */

export async function listGateways(ctx: Ctx) {
  const rows = await ctx.store.list("gateways", scopedQuery(ctx.session, "village_id", { order: { name: "asc" } }));
  return rows.map(row => ({
    id: row.id,
    villageId: row.village_id,
    gatewayCode: row.gateway_code,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    firmwareVersion: row.firmware_version,
    online: row.online === true,
    lastSeenAt: row.last_seen_at,
    hasKey: Boolean(row.auth_key_hash)
  }));
}

export async function createGateway(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT"], "Hanya JAGA Pusat yang dapat mendaftarkan gateway");
  const villageId = clean(ctx.body.villageId);
  assertVillageAccess(ctx.session, villageId);
  const code = text(ctx.body.gatewayCode, "Kode gateway", { max: 60 });
  if (await ctx.store.one("gateways", { eq: { gateway_code: code } })) throw conflict("Kode gateway sudah dipakai");
  const key = newGatewayKey();
  const gateway = await ctx.store.insert("gateways", {
    village_id: villageId,
    gateway_code: code,
    name: text(ctx.body.name, "Nama gateway", { max: 160 }),
    latitude: coordinate(ctx.body.latitude, 90),
    longitude: coordinate(ctx.body.longitude, 180),
    firmware_version: optionalText(ctx.body.firmwareVersion, "Firmware", 40),
    online: false,
    last_seen_at: null,
    auth_key_hash: sha256Hex(key),
    created_at: nowIso()
  });
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "GATEWAY_CREATE", entityType: "gateways",
    entityId: String(gateway.id), summary: `Mendaftarkan gateway ${code}`, after: gateway
  });
  return { id: gateway.id, gatewayCode: code, gatewayKey: key, note: "Kunci hanya ditampilkan sekali." };
}

export async function rotateGatewayKey(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT"]);
  const gateway = await ctx.store.one("gateways", { eq: { id: param(ctx, "id") } });
  if (!gateway) throw notFound("Gateway tidak ditemukan");
  const key = newGatewayKey();
  await ctx.store.update("gateways", param(ctx, "id"), { auth_key_hash: sha256Hex(key), updated_at: nowIso() });
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "GATEWAY_KEY_ROTATE", entityType: "gateways",
    entityId: param(ctx, "id"), summary: `Rotasi kunci gateway ${gateway.gateway_code}`
  });
  return { gatewayId: gateway.id, gatewayCode: gateway.gateway_code, gatewayKey: key };
}

/* ------------------------------------------------------- Ingest perangkat */

export async function ingestTelemetry(ctx: Ctx) {
  const device = ctx.device;
  if (!device) throw badRequest("Endpoint ini hanya untuk perangkat");
  const rawBattery = optionalNumber(ctx.body.battery);
  if (ctx.body.battery !== undefined && ctx.body.battery !== null && ctx.body.battery !== "" && rawBattery === null) {
    throw badRequest("Baterai harus berupa angka");
  }
  const battery = rawBattery === null ? null : Math.round(Math.min(100, Math.max(0, rawBattery)));
  let latitude = coordinate(ctx.body.latitude, 90);
  let longitude = coordinate(ctx.body.longitude, 180);
  if (latitude === null || longitude === null) { latitude = null; longitude = null; }
  const gatewayId = ctx.gateway ? String(ctx.gateway.gateway.id) : null;

  const patch: Row = { last_seen_at: nowIso(), online: true, updated_at: nowIso() };
  if (battery !== null) patch.battery = battery;
  if (latitude !== null) patch.latitude = latitude;
  if (longitude !== null) patch.longitude = longitude;
  const updated = await ctx.store.update("devices", String(device.id), patch);

  const reading = await ctx.store.insert("device_telemetry", {
    device_id: String(device.id),
    gateway_id: gatewayId,
    battery,
    signal_strength: optionalNumber(ctx.body.signalStrength),
    temperature: optionalNumber(ctx.body.temperature),
    payload: ctx.body.payload && typeof ctx.body.payload === "object" ? ctx.body.payload : {},
    recorded_at: nowIso()
  });

  // Satu notifikasi per penurunan ke ambang; tidak diulang selama baterai masih rendah.
  const wasLow = device.battery !== null && device.battery !== undefined && Number(device.battery) <= 10;
  if (battery !== null && battery <= 10 && !wasLow && String(device.status) === "ASSIGNED") {
    await ctx.store.insert("notifications", {
      profile_id: null,
      village_id: device.village_id ?? null,
      channel: "IN_APP",
      title: "Baterai perangkat hampir habis",
      body: `Perangkat ${device.id} tinggal ${battery}%.`,
      status: "QUEUED",
      created_at: nowIso()
    });
  }
  publish("device.updated", { id: device.id, battery, online: true, latitude, longitude }, String(device.village_id ?? ""));
  return { accepted: true, deviceId: device.id, readingId: reading.id ?? null, updated: deviceShape(updated ?? device) };
}

export async function deviceInbox(ctx: Ctx) {
  const device = ctx.device;
  if (!device) throw badRequest("Endpoint ini hanya untuk perangkat");
  const assignment = ctx.deviceAuth
    ? await ctx.store.one("device_assignments", { eq: { device_id: String(device.id) }, isNull: { unassigned_at: true } })
    : null;
  const residentId = assignment?.resident_id ? String(assignment.resident_id) : null;
  const resident = residentId ? await ctx.store.one("residents", { eq: { id: residentId } }) : null;
  const villageId = resident?.village_id ? String(resident.village_id) : null;
  const devices = villageId ? await ctx.store.list("devices", { eq: { village_id: villageId } }) : [];
  // Perintah untuk perangkat ini: receipt miliknya yang belum dikonfirmasi dan belum kedaluwarsa.
  const receipts = await ctx.store.list("command_receipts", { eq: { device_id: String(device.id) }, in: { status: ["QUEUED", "SENT"] } });
  const commandRows = receipts.length ? await ctx.store.list("alert_commands", { in: { id: receipts.map(row => String(row.command_id)) } }) : [];
  const commandMap = indexBy(commandRows, row => String(row.id));
  const now = nowIso();
  const openCommands = receipts
    .map(receipt => ({ receipt, command: commandMap.get(String(receipt.command_id)) }))
    .filter(item => item.command
      && (!item.command.expires_at || String(item.command.expires_at) > now)
      && !["EXPIRED", "FAILED"].includes(String(item.command.status))) as Array<{ receipt: Row; command: Row }>;
  // Mengambil perintah dari inbox berarti perintah sudah sampai ke perangkat: QUEUED -> SENT.
  const touched = new Set<string>();
  for (const { receipt, command } of openCommands) {
    if (String(receipt.status) === "QUEUED") {
      await ctx.store.update("command_receipts", String(receipt.id), { status: "SENT", sent_at: nowIso() });
      touched.add(String(command.id));
    }
  }
  for (const commandId of touched) await refreshCommandStatus(ctx, commandId);
  return {
    deviceId: device.id,
    residentId,
    villageId,
    villageCoordinates: villageId ? await villageCenter(ctx, villageId) : null,
    activeDevices: devices.filter(item => item.online === true).map(item => ({ id: item.id, latitude: item.latitude, longitude: item.longitude })),
    commands: openCommands.slice(0, 20).map(({ receipt, command }) => ({
      id: command.id, receiptId: receipt.id, severity: command.severity, message: command.message, expiresAt: command.expires_at
    })),
    serverTime: nowIso()
  };
}

const villageCenter = async (ctx: Ctx, villageId: string): Promise<Row | null> => {
  const village = await ctx.store.one("villages", { eq: { id: villageId } });
  if (!village) return null;
  return { latitude: village.latitude ?? null, longitude: village.longitude ?? null, name: village.name };
};

export async function deviceLocation(ctx: Ctx) {
  const device = ctx.device;
  if (!device) throw badRequest("Endpoint ini hanya untuk perangkat");
  return {
    deviceId: device.id,
    villageId: device.village_id,
    battery: device.battery,
    latitude: device.latitude,
    longitude: device.longitude,
    status: device.status,
    lastSeenAt: device.last_seen_at
  };
}

/** SOS dari kalung (langsung atau lewat gateway). Membuat insiden untuk warga pemegang kalung. */
export async function deviceSos(ctx: Ctx) {
  const device = ctx.device;
  if (!device) throw badRequest("Endpoint ini hanya untuk perangkat");
  const open = await ctx.store.one("incidents", {
    eq: { device_id: String(device.id) },
    pred: row => !["SAFE", "CANCELLED", "CLOSED"].includes(String(row.status))
  });
  if (open) return { accepted: true, duplicate: true, incidentId: open.id, status: open.status };

  const residentId = ctx.deviceAuth?.residentId ?? null;
  const latitude = coordinate(ctx.body.latitude, 90) ?? coordinate(device.latitude, 90);
  const longitude = coordinate(ctx.body.longitude, 180) ?? coordinate(device.longitude, 180);
  const villageIds = device.village_id ? [String(device.village_id)] : [];
  const incident = await createSos({
    ...ctx,
    body: {
      residentId,
      villageId: residentId ? undefined : device.village_id,
      deviceId: String(device.id),
      latitude,
      longitude,
      ownerName: device.owner_name || undefined,
      disasterType: ctx.body.disasterType,
      severity: ctx.body.severity,
      description: optionalText(ctx.body.description, "Keterangan", 500) ?? "SOS dari JAGA Rumah",
      source: ctx.gateway ? "GATEWAY" : "DEVICE"
    },
    session: { ...ctx.session, role: "DESA", villageIds, profileId: `device:${device.id}` }
  } as Ctx);
  return { accepted: true, duplicate: false, incidentId: (incident as Row).id, status: (incident as Row).status, ack: "SOS_DITERIMA" };
}

export const deviceStatuses = () => DEVICE_STATUSES;
export { deviceShape };
