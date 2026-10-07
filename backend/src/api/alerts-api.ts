import { actorOf, notify, record } from "../audit.js";
import { assertVillageAccess, requireRole, scopeIds } from "../auth.js";
import { badRequest, clean, forbidden, indexBy, isOnline, isUuid, notFound, nowIso, oneOf, optionalText, requireUuid, text } from "../lib.js";
import { publish } from "../realtime.js";
import { param, type Ctx } from "../router.js";
import type { Row } from "../types.js";
import { scopedQuery } from "./common.js";
import { AUTO_OPEN_SEVERITIES, openOrEscalateOperation } from "./operations-api.js";
import { getSettings } from "./platform-api.js";

const SEVERITIES = ["WASPADA", "SIAGA", "AWAS"] as const;
const TARGET_TYPES = ["DESA", "KELOMPOK_RENTAN", "PERANGKAT", "ZONA"] as const;

export async function listAlerts(ctx: Ctx) {
  const villageId = clean(ctx.query.get("villageId"));
  const rows = await ctx.store.list("alert_commands", scopedQuery(ctx.session, "village_id", {
    ...(villageId ? { eq: { village_id: villageId } } : {}),
    order: { created_at: "desc" },
    limit: 100
  }));
  if (!rows.length) return [];
  const receipts = await ctx.store.list("command_receipts", { in: { command_id: rows.map(row => String(row.id)) } });
  const byCommand = new Map<string, Row[]>();
  for (const receipt of receipts) {
    const key = String(receipt.command_id);
    byCommand.set(key, [...(byCommand.get(key) ?? []), receipt]);
  }
  return rows.map(row => {
    const list = byCommand.get(String(row.id)) ?? [];
    return {
      id: row.id,
      villageId: row.village_id,
      target: row.target,
      targetType: row.target_type,
      targetReference: row.target_reference,
      severity: row.severity,
      message: row.message,
      status: row.status,
      requestedBy: row.requested_by,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      receipts: {
        total: list.length,
        queued: list.filter(item => item.status === "QUEUED").length,
        sent: list.filter(item => item.status === "SENT").length,
        acknowledged: list.filter(item => item.status === "ACKNOWLEDGED").length,
        failed: list.filter(item => item.status === "FAILED").length
      }
    };
  });
}

export async function getAlert(ctx: Ctx) {
  const command = await ctx.store.one("alert_commands", { eq: { id: param(ctx, "id") } });
  if (!command) throw notFound("Peringatan tidak ditemukan");
  assertVillageAccess(ctx.session, command.village_id);
  const receipts = await ctx.store.list("command_receipts", { eq: { command_id: param(ctx, "id") } });
  const deviceIds = receipts.map(row => String(row.device_id));
  const devices = deviceIds.length ? await ctx.store.list("devices", { in: { id: deviceIds } }) : [];
  const deviceMap = indexBy(devices, row => String(row.id));
  return {
    ...command,
    receipts: receipts.map(row => {
      const device = deviceMap.get(String(row.device_id)) ?? null;
      // Rescue tidak perlu identitas pemilik/lokasi rumah; cukup status perangkat.
      const shown = device && ctx.session.role === "RESCUE"
        ? { id: device.id, status: device.status, battery: device.battery, online: device.online }
        : device;
      return { ...row, device: shown };
    })
  };
}

export async function createAlert(ctx: Ctx) {
  requireRole(ctx.session, ["DESA"], "Hanya JAGA Desa yang dapat membunyikan alarm. Pusat memantau dan menerima informasinya");
  const body = ctx.body;
  const villageId = requireUuid(body.villageId, "Desa");
  assertVillageAccess(ctx.session, villageId);
  const village = await ctx.store.one("villages", { eq: { id: villageId } });
  if (!village) throw badRequest("Desa tidak ditemukan");
  const targetType = oneOf(body.targetType ?? "DESA", TARGET_TYPES, "Tipe target");
  const severity = oneOf(body.severity ?? "WASPADA", SEVERITIES, "Tingkat kewaspadaan");
  const message = text(body.message, "Isi peringatan", { max: 1000 });
  const targetReference = optionalText(body.targetReference, "Referensi target", 200);

  const target = text(String(body.target ?? (targetReference || `Seluruh ${village.name}`)).slice(0, 200), "Target", { max: 200 });

  // Sasaran dihitung lebih dulu: peringatan tanpa perangkat sasaran ditolak, bukan dikirim ke semua orang.
  const deviceIds = await resolveTargets(ctx, { villageId, targetType, targetReference });
  if (!deviceIds.length) throw badRequest("Tidak ada perangkat sasaran untuk target ini. Periksa target dan pemasangan kalung.");
  const devices = await ctx.store.list("devices", { in: { id: deviceIds }, eq: { village_id: villageId } });
  if (!devices.length) throw badRequest("Perangkat sasaran tidak ditemukan di desa ini");

  const defaultExpiry = (await getSettings(ctx.store)).alert_expiry_minutes;
  const expiresMinutes = Math.min(10080, Math.max(1, Number(body.expiresInMinutes ?? defaultExpiry) || defaultExpiry));
  const command = await ctx.store.insert("alert_commands", {
    village_id: villageId,
    target,
    target_type: targetType,
    target_reference: targetReference,
    severity,
    message,
    // Status naik menjadi SENT saat perangkat mengambil perintah dari inbox, lalu ACKNOWLEDGED setelah dikonfirmasi.
    status: "QUEUED",
    requested_by: actorOf(ctx.session),
    created_at: nowIso(),
    expires_at: new Date(Date.now() + expiresMinutes * 60_000).toISOString()
  });
  await ctx.store.insertMany("command_receipts", devices.map(device => ({
    command_id: command.id,
    device_id: String(device.id),
    status: "QUEUED"
  })));

  const notifications = [];
  const channels = channelsFor(ctx.body.channels);
  if (channels.includes("IN_APP")) {
    notifications.push(await notify(ctx.store, {
      session: ctx.session, channel: "IN_APP", destination: villageId,
      templateCode: `ALERT_${severity}`, body: `${severity}: ${message}`, villageId
    }));
  }
  const external = channels.filter(channel => channel !== "IN_APP");
  if (external.length) {
    for (const resident of await resolveResidents(ctx, { villageId, targetType, targetReference })) {
      for (const channel of external) {
        const destination = String(resident.phone ?? "");
        if (!destination) continue;
        notifications.push(await notify(ctx.store, {
          session: ctx.session, residentId: String(resident.id), channel: channel as "PUSH" | "SMS" | "EMAIL",
          destination, templateCode: `ALERT_${severity}`, body: `${severity}: ${message}`, villageId
        }));
      }
    }
  }

  // Alarm area tingkat Siaga/Awas membuka operasi: Rescue otomatis mendapat roster pemakai kalung di area itu.
  let operation: Row | null = null;
  if (targetType === "DESA" && AUTO_OPEN_SEVERITIES.includes(severity)) {
    operation = await openOrEscalateOperation(ctx, {
      villageId, severity, commandId: String(command.id),
      waterLevelCm: body.waterLevelCm, note: body.observationNote, disasterType: body.disasterType
    });
  }

  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "ALERT_SEND", entityType: "alert_commands",
    entityId: String(command.id), summary: `Peringatan ${severity} untuk ${targetType} ${target}`, after: command
  });
  publish("alert.created", { id: command.id, severity, message, targetType, target }, villageId);
  return {
    command,
    devicesReached: devices.length,
    operation,
    residentsNotified: new Set(notifications.map(item => item.notificationId)).size,
    notifications
  };
}

/**
 * Sinyal darurat satu tombol: peringatan AWAS ke seluruh kalung desa (kalung berbunyi, bergetar, dan menyala)
 * sekaligus membuka operasi Rescue. Sama dengan alarm penuh, tetapi tanpa pilihan lain agar bisa dipicu secepatnya.
 */
export async function emergencyAlert(ctx: Ctx) {
  requireRole(ctx.session, ["DESA"], "Hanya JAGA Desa yang dapat mengirim sinyal darurat");
  // Tombol satu langkah tidak boleh terpicu oleh panggilan tanpa maksud (isi kosong, pemindai, salah klik).
  if (ctx.body.confirm !== true) throw badRequest("Sinyal darurat wajib dikonfirmasi: kirim confirm=true");
  const own = ctx.session.villageIds?.length === 1 ? String(ctx.session.villageIds[0]) : "";
  const villageId = clean(ctx.body.villageId) || own;
  if (!villageId) throw badRequest("villageId wajib diisi");
  assertVillageAccess(ctx.session, villageId);
  const source = ctx.body;
  ctx.body = {
    villageId,
    targetType: "DESA",
    severity: "AWAS",
    message: optionalText(source.message, "Pesan", 1000) ?? "SINYAL DARURAT: segera menuju titik aman bersama pendamping.",
    waterLevelCm: source.waterLevelCm,
    observationNote: source.observationNote,
    disasterType: source.disasterType
  };
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "ALERT_EMERGENCY", entityType: "villages", entityId: villageId,
    summary: "Sinyal darurat satu tombol dipicu"
  });
  return createAlert(ctx);
}

const channelsFor = (value: unknown): string[] => {
  const list = Array.isArray(value) ? value.map(String) : value ? [String(value)] : ["IN_APP"];
  const valid = list.filter(entry => ["IN_APP", "PUSH", "SMS", "EMAIL"].includes(entry));
  return valid.length ? valid : ["IN_APP"];
};

/** Perangkat sasaran. Selalu dibatasi pada desa peringatan; tidak ada fallback ke "semua perangkat". */
async function resolveTargets(ctx: Ctx, options: { villageId: string; targetType: string; targetReference: string | null}): Promise<string[]> {
  const { villageId, targetType, targetReference } = options;
  if (targetType === "PERANGKAT") {
    if (!targetReference) throw badRequest("Target perangkat memerlukan targetReference berisi ID perangkat");
    const device = await ctx.store.one("devices", { eq: { id: targetReference } });
    if (!device || String(device.village_id) !== villageId) throw badRequest("Perangkat tidak ditemukan di desa ini");
    return [String(device.id)];
  }
  if (targetType === "ZONA") throw badRequest("Target ZONA belum didukung. Pilih DESA, KELOMPOK_RENTAN, atau PERANGKAT.");
  if (targetType === "DESA") {
    const all = await ctx.store.list("devices", { eq: { village_id: villageId } });
    return all.filter(row => !["LOST", "RETIRED", "STOCK"].includes(String(row.status))).map(row => String(row.id));
  }
  const residents = await resolveResidents(ctx, options);
  if (!residents.length) return [];
  const assignments = await ctx.store.list("device_assignments", { in: { resident_id: residents.map(row => String(row.id)) }, isNull: { unassigned_at: true } });
  return assignments.map(row => String(row.device_id));
}

async function resolveResidents(ctx: Ctx, options: { villageId: string; targetType: string; targetReference: string | null}): Promise<Row[]> {
  const { villageId, targetType, targetReference } = options;
  const residents = await ctx.store.list("residents", { eq: { village_id: villageId, active: true } });
  if (targetType !== "KELOMPOK_RENTAN") return residents;

  // Referensi boleh berupa id jenis kerentanan, kode, atau kategorinya.
  if (!targetReference) throw badRequest("Kelompok rentan memerlukan referensi jenis kerentanan");
  const types = await ctx.store.list("vulnerability_types", {});
  const matched = new Set(types
    .filter(type => String(type.id) === targetReference || String(type.code) === targetReference || String(type.category) === targetReference)
    .map(type => String(type.id)));
  if (!matched.size) throw badRequest("Jenis kerentanan pada referensi tidak dikenal");
  const vulnerable = await ctx.store.list("resident_vulnerabilities", { in: { vulnerability_type_id: Array.from(matched) } });
  const residentIds = new Set(vulnerable.map(row => String(row.resident_id)));
  return residents.filter(row => residentIds.has(String(row.id)));
}

export async function acknowledgeAlert(ctx: Ctx) {
  const receipt = await ctx.store.one("command_receipts", { eq: { id: param(ctx, "receiptId") } });
  if (!receipt) throw notFound("Penerimaan peringatan tidak ditemukan");
  // Perangkat hanya boleh mengonfirmasi receipt miliknya sendiri.
  if (ctx.device && String(receipt.device_id) !== String(ctx.device.id)) throw forbidden("Receipt ini bukan milik perangkat Anda");
  const command = await ctx.store.one("alert_commands", { eq: { id: String(receipt.command_id) } });
  if (command) assertVillageAccess(ctx.session, command.village_id);
  const status = oneOf(ctx.body.status ?? "ACKNOWLEDGED", ["SENT", "ACKNOWLEDGED", "FAILED", "EXPIRED"] as const, "Status");
  if (status === "FAILED" && !ctx.body.reason) throw badRequest("Status FAILED memerlukan alasan kegagalan");
  const patch: Row = { status };
  if (status === "ACKNOWLEDGED") patch.acknowledged_at = nowIso();
  if (status === "FAILED") patch.failure_reason = optionalText(ctx.body.reason, "Alasan", 500);
  const updated = await ctx.store.update("command_receipts", param(ctx, "receiptId"), patch);
  if (command) await refreshCommandStatus(ctx, String(command.id));
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "ALERT_RECEIPT", entityType: "alert_commands",
    entityId: String(receipt.command_id), summary: `Penerimaan peringatan ${receipt.device_id}: ${status}`, after: updated
  });
  if (command) publish("alert.receipt", { commandId: receipt.command_id, deviceId: receipt.device_id, status }, String(command.village_id ?? ""));
  return updated;
}

/** Status perintah mengikuti receipt: ACKNOWLEDGED bila semua perangkat sudah menjawab, SENT bila ada yang terkirim. */
export async function refreshCommandStatus(ctx: Ctx, commandId: string) {
  const receipts = await ctx.store.list("command_receipts", { eq: { command_id: commandId } });
  if (!receipts.length) return;
  const pending = receipts.some(row => ["QUEUED", "SENT"].includes(String(row.status)));
  const next = !pending ? (receipts.some(row => row.status === "ACKNOWLEDGED") ? "ACKNOWLEDGED" : "FAILED")
    : receipts.some(row => row.status !== "QUEUED") ? "SENT" : "QUEUED";
  await ctx.store.update("alert_commands", commandId, { status: next });
}

export async function expireAlerts(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT"]);
  const now = nowIso();
  const all = await ctx.store.list("alert_commands", {});
  const expired = all.filter(row => row.expires_at && String(row.expires_at) < now && !["EXPIRED", "ACKNOWLEDGED"].includes(String(row.status)));
  for (const command of expired) {
    await ctx.store.update("alert_commands", String(command.id), { status: "EXPIRED" });
    const receipts = await ctx.store.list("command_receipts", { eq: { command_id: String(command.id) } });
    for (const receipt of receipts) {
      if (["QUEUED", "SENT"].includes(String(receipt.status))) {
        await ctx.store.update("command_receipts", String(receipt.id), { status: "EXPIRED" });
      }
    }
  }
  return { expired: expired.length, checkedAt: now };
}

export async function listNotifications(ctx: Ctx) {
  const ids = scopeIds(ctx.session);
  const rows = await ctx.store.list("notifications", {
    ...(ids === null ? {} : { in: { village_id: ids.length ? ids : ["__tidak_ada_desa_yang_terdaftar__"] } }),
    order: { created_at: "desc" },
    limit: 200
  });
  // Notifikasi yang ditujukan ke satu profil hanya terlihat oleh profil itu (dan PUSAT).
  const visible = rows.filter(row => !row.profile_id || ctx.session.role === "PUSAT" || String(row.profile_id) === ctx.session.profileId || row.channel === "IN_APP");
  return visible.map(row => ({
    id: row.id,
    channel: row.channel,
    title: row.title,
    body: row.body,
    status: row.status,
    incidentId: row.incident_id,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    readAt: row.read_at
  }));
}

export async function markNotificationRead(ctx: Ctx) {
  const row = await ctx.store.one("notifications", { eq: { id: param(ctx, "id") } });
  if (!row) throw notFound("Notifikasi tidak ditemukan");
  if (row.village_id) assertVillageAccess(ctx.session, row.village_id);
  else if (ctx.session.role !== "PUSAT" && String(row.profile_id) !== ctx.session.profileId) throw forbidden("Notifikasi ini bukan untuk akun Anda");
  return ctx.store.update("notifications", param(ctx, "id"), { status: "READ", read_at: nowIso() });
}

export { resolveTargets, resolveResidents };

/* ------------------------------------------------------------------ Alarm aktif per kalung */

/**
 * Alarm yang sedang aktif di sebuah kalung: receipt belum dilepas, perintah belum kedaluwarsa. Selama aktif, tombol di
 * kalung terbuka (SRS FR-4.3); setelah Rescue memastikan warga aman/dievakuasi atau operasi ditutup, tombol terkunci lagi.
 */
export async function activeAlarmFor(store: Ctx["store"], deviceId: string): Promise<{ receipt: Row; command: Row } | null> {
  const receipts = (await store.list("command_receipts", { eq: { device_id: deviceId }, in: { status: ["QUEUED", "SENT", "ACKNOWLEDGED"] } }))
    .filter(row => !row.released_at);
  if (!receipts.length) return null;
  const commands = await store.list("alert_commands", { in: { id: receipts.map(row => String(row.command_id)) } });
  const now = nowIso();
  const live = receipts
    .map(receipt => ({ receipt, command: commands.find(command => String(command.id) === String(receipt.command_id)) }))
    .filter(item => item.command
      && (!item.command.expires_at || String(item.command.expires_at) > now)
      && !["EXPIRED", "FAILED"].includes(String(item.command.status))) as Array<{ receipt: Row; command: Row }>;
  live.sort((x, y) => String(y.command.created_at).localeCompare(String(x.command.created_at)));
  return live[0] ?? null;
}

/** Melepas alarm sebuah kalung (tombol kembali terkunci). */
export async function releaseDeviceAlarm(store: Ctx["store"], deviceId: string): Promise<void> {
  const receipts = (await store.list("command_receipts", { eq: { device_id: deviceId } })).filter(row => !row.released_at);
  for (const row of receipts) await store.update("command_receipts", String(row.id), { released_at: nowIso() });
}

/** Melepas seluruh alarm kalung di sebuah desa (dipakai saat operasi ditutup). */
export async function releaseVillageAlarms(store: Ctx["store"], villageId: string): Promise<void> {
  const devices = await store.list("devices", { eq: { village_id: villageId } });
  for (const device of devices) {
    // Warga yang masih menunggu bantuan tetap memegang alarmnya sampai Rescue memastikan aman.
    const waiting = await store.one("incidents", { eq: { device_id: String(device.id) }, pred: row => !["SAFE", "CANCELLED", "CLOSED"].includes(String(row.status)) });
    if (!waiting) await releaseDeviceAlarm(store, String(device.id));
  }
}

const BOARD_LABEL: Record<string, string> = {
  MENUNGGU: "Alarm terkirim, belum merespons",
  BANTUAN: "Meminta bantuan",
  AMAN: "Aman atau dievakuasi",
  TIDAK_DITEMUKAN: "Tidak ditemukan",
  TIDAK_TERJANGKAU: "Tidak terjangkau atau alarm gagal",
  NORMAL: "Tidak ada alarm aktif"
};

/**
 * Papan status per penerima manfaat (SRS FR-2.6): alarm terkirim tanpa respons, meminta bantuan (tombol ditekan),
 * atau aman/dievakuasi (dikonfirmasi JAGA Rescue).
 */
export async function statusBoard(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT", "DESA"], "Papan status untuk JAGA Desa dan JAGA Pusat");
  const wanted = clean(ctx.query.get("villageId"));
  const ids = scopeIds(ctx.session);
  if (wanted) assertVillageAccess(ctx.session, wanted);
  const villages = await ctx.store.list("villages", wanted ? { eq: { id: wanted } } : ids === null ? {} : { in: { id: ids.length ? ids : ["__tidak_ada__"] } });
  const villageIds = villages.map(row => String(row.id));
  const residents = villageIds.length ? await ctx.store.list("residents", { in: { village_id: villageIds }, eq: { active: true } }) : [];
  const assignments = residents.length ? await ctx.store.list("device_assignments", { in: { resident_id: residents.map(row => String(row.id)) }, isNull: { unassigned_at: true } }) : [];
  const deviceIds = assignments.map(row => String(row.device_id));
  const [devices, receipts, incidents] = deviceIds.length
    ? await Promise.all([
        ctx.store.list("devices", { in: { id: deviceIds } }),
        ctx.store.list("command_receipts", { in: { device_id: deviceIds } }),
        ctx.store.list("incidents", { in: { device_id: deviceIds } })
      ])
    : [[], [], []];
  const commands = receipts.length ? await ctx.store.list("alert_commands", { in: { id: Array.from(new Set(receipts.map(row => String(row.command_id)))) } }) : [];
  const commandOf = indexBy(commands, row => String(row.id));
  const deviceOf = indexBy(devices, row => String(row.id));
  const residentOf = indexBy(residents, row => String(row.id));
  const villageOf = indexBy(villages, row => String(row.id));
  const now = nowIso();

  const rows = assignments.map(assignment => {
    const device = deviceOf.get(String(assignment.device_id));
    const resident = residentOf.get(String(assignment.resident_id));
    if (!device || !resident) return null;
    const mine = receipts
      .filter(row => String(row.device_id) === String(device.id) && commandOf.has(String(row.command_id)))
      .sort((x, y) => String(commandOf.get(String(y.command_id))?.created_at).localeCompare(String(commandOf.get(String(x.command_id))?.created_at)));
    const receipt = mine[0] ?? null;
    const command = receipt ? commandOf.get(String(receipt.command_id)) ?? null : null;
    const alarmLive = Boolean(receipt && command && !receipt.released_at && (!command.expires_at || String(command.expires_at) > now) && !["EXPIRED", "FAILED"].includes(String(command.status)));
    const incident = command
      ? incidents.filter(row => String(row.device_id) === String(device.id)
          && (String(row.created_at) >= String(command.created_at) || String(row.updated_at ?? row.closed_at ?? "") >= String(command.created_at)
            || !["SAFE", "CANCELLED", "CLOSED"].includes(String(row.status))))
          .sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))[0] ?? null
      : null;
    let state = "NORMAL";
    if (incident && ["SAFE", "EVACUATED"].includes(String(incident.status))) state = "AMAN";
    else if (incident && String(incident.status) === "NOT_FOUND") state = "TIDAK_DITEMUKAN";
    else if (incident && String(incident.status) === "UNREACHABLE") state = "TIDAK_TERJANGKAU";
    else if (incident || (alarmLive && receipt?.assistance_requested_at)) state = "BANTUAN";
    else if (alarmLive && (["FAILED", "EXPIRED"].includes(String(receipt?.status)) || !isOnline(device))) state = "TIDAK_TERJANGKAU";
    else if (alarmLive) state = "MENUNGGU";
    return {
      villageId: resident.village_id, villageName: villageOf.get(String(resident.village_id))?.name ?? null,
      residentId: resident.id, residentName: resident.full_name, deviceId: device.id,
      online: isOnline(device), battery: device.battery ?? null,
      state, stateLabel: BOARD_LABEL[state],
      alarmSeverity: alarmLive ? command?.severity ?? null : null,
      alarmAt: command?.created_at ?? null,
      assistanceAt: receipt?.assistance_requested_at ?? null,
      incidentId: incident?.id ?? null, incidentStatus: incident?.status ?? null
    };
  }).filter((row): row is NonNullable<typeof row> => row !== null);

  const order = ["BANTUAN", "TIDAK_TERJANGKAU", "TIDAK_DITEMUKAN", "MENUNGGU", "AMAN", "NORMAL"];
  rows.sort((x, y) => order.indexOf(x.state) - order.indexOf(y.state) || String(x.residentName).localeCompare(String(y.residentName), "id"));
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.state] = (counts[row.state] ?? 0) + 1;
  return { counts, labels: BOARD_LABEL, rows };
}
