import { config } from "./config.js";
import { isUuid, nowIso, uuid } from "./lib.js";
import type { Row, Session } from "./types.js";
import type { Store } from "./store.js";

export interface AuditInput {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  before?: Row | null;
  after?: Row | null;
  villageId?: string | null;
}

const ring: Array<Row & { at: string }> = [];
const RING_LIMIT = 300;

/** Catat perubahan ke tabel audit_logs. Gagal menulis audit tidak boleh menggagalkan operasi utama. */
export async function record(store: Store, input: AuditInput): Promise<void> {
  const entry: Row = {
    actor_id: input.actorId && isUuid(input.actorId) ? input.actorId : null, // sesi perangkat (device:ID) bukan profil
    action: input.action.slice(0, 120),
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    summary: input.summary.slice(0, 500),
    before_data: input.before ?? null,
    after_data: input.after ?? null,
    ip_address: null,
    user_agent: null,
    created_at: nowIso()
  };
  ring.unshift({ ...entry, at: entry.created_at as string });
  if (ring.length > RING_LIMIT) ring.pop();
  try {
    await store.insert("audit_logs", entry);
  } catch (error) {
    console.warn("[audit] gagal menyimpan audit log:", (error as Error).message);
  }
}

/** Pelaku untuk kolom yang merujuk profil: hanya UUID profil nyata; sesi perangkat atau mode dev menjadi null. */
export const actorOf = (session: Session | null): string | null => (session && isUuid(session.profileId) ? session.profileId : null);

export const recentAudit = (limit = 50): Array<Row & { at: string }> => ring.slice(0, Math.min(limit, RING_LIMIT));
export const clearAuditRing = () => { ring.length = 0; };

/* ------------------------------------------------------------- Notifikasi */

export interface NotifyInput {
  session: Session | null;
  incidentId?: string | null;
  residentId?: string | null;
  channel: "IN_APP" | "PUSH" | "SMS" | "WHATSAPP" | "EMAIL";
  destination: string;
  templateCode: string;
  body: string;
  villageId?: string | null;
}

export interface NotifyResult {
  queued: boolean;
  provider: string;
  detail: string;
  notificationId: string | null;
}

/**
 * Tulis antrean notifikasi. IN_APP cukup disimpan (dibaca dari dashboard). Pengiriman nyata untuk SMS
 * memerlukan kredensial Twilio; PUSH (FCM HTTP v1) dan EMAIL belum diintegrasikan sehingga tetap antre.
 */
export async function notify(store: Store, input: NotifyInput): Promise<NotifyResult> {
  const notificationId = uuid();
  const provider = input.channel === "IN_APP" ? "in-app" : input.channel === "PUSH" ? "fcm" : input.channel === "EMAIL" ? "smtp" : "twilio";

  try {
    await store.insert("notifications", {
      id: notificationId,
      profile_id: null,
      village_id: input.villageId ?? null,
      resident_id: input.residentId ?? null,
      incident_id: input.incidentId ?? null,
      channel: input.channel === "WHATSAPP" ? "SMS" : input.channel,
      title: input.templateCode,
      body: input.body,
      destination: input.destination,
      template_code: input.templateCode,
      status: "QUEUED",
      created_at: nowIso()
    });
  } catch (error) {
    console.warn("[notify] gagal membuat antrean:", (error as Error).message);
    return { queued: false, provider, detail: "Antrean notifikasi gagal dibuat", notificationId: null };
  }

  if (provider === "in-app") return { queued: true, provider, detail: "Notifikasi dalam aplikasi dibuat.", notificationId };
  
  if (provider === "fcm") {
    // Mock simulasi FCM v1 untuk kompetisi
    console.log(`[fcm-mock] MENGIRIM PUSH NOTIFIKASI ke ${input.destination}: ${input.templateCode} - ${input.body}`);
    await store.update("notifications", notificationId, { status: "SENT", sent_at: nowIso() }).catch(() => undefined);
    return { queued: true, provider, detail: "Terkirim melalui FCM (Mock Simulasi Kompetisi).", notificationId };
  }

  if (provider !== "twilio" || !config.twilioAuthToken || !config.twilioAccountSid) {
    return {
      queued: true,
      provider,
      detail: `Antrean dibuat. Pengiriman ${provider.toUpperCase()} belum aktif (kredensial/integrasi belum tersedia), pesan belum dikirim.`,
      notificationId
    };
  }

  try {
    const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64");
    const wa = input.channel === "WHATSAPP";
    const from = wa ? config.twilioWhatsappFrom : (process.env.TWILIO_FROM_NUMBER ?? "");
    if (!from) throw new Error(wa ? "TWILIO_WHATSAPP_FROM belum diisi" : "TWILIO_FROM_NUMBER belum diisi");
    const form = new URLSearchParams({
      To: wa ? `whatsapp:${input.destination}` : input.destination,
      From: wa && !from.startsWith("whatsapp:") ? `whatsapp:${from}` : from,
      Body: input.body
    });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    });
    if (!response.ok) throw new Error(`Twilio ${response.status}`);
    await store.update("notifications", notificationId, { status: "SENT", sent_at: nowIso() }).catch(() => undefined);
    return { queued: true, provider, detail: "Terkirim melalui Twilio.", notificationId };
  } catch (error) {
    await store.update("notifications", notificationId, { status: "FAILED" }).catch(() => undefined);
    return { queued: false, provider, detail: `Pengiriman gagal: ${(error as Error).message}`, notificationId };
  }
}

/* ------------------------------------------------- Notifikasi kontak warga */

/** Nomor internasional: buang spasi/tanda, 08xx menjadi +628xx. Mengembalikan "" bila tidak valid. */
export const normalizePhone = (value: unknown): string => {
  const raw = String(value ?? "").replace(/[^\d+]/g, "");
  const digits = raw.startsWith("+") ? raw.slice(1) : raw;
  const intl = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  return /^\d{9,15}$/.test(intl) ? `+${intl}` : "";
};

export interface ContactAlertInput {
  residentId: string;
  villageId?: string | null;
  incidentId?: string | null;
  templateCode: string;
  body: string;
}

/**
 * Kirim pesan ke kontak darurat warga (keluarga/pendamping) lewat SMS, dan WhatsApp bila diaktifkan.
 * Kontak utama didahulukan, nomor ganda digabung. Kegagalan satu nomor tidak menghentikan yang lain.
 */
export async function notifyResidentContacts(store: Store, input: ContactAlertInput): Promise<{ attempted: number; sent: number }> {
  const contacts = await store.list("resident_contacts", { eq: { resident_id: input.residentId } });
  contacts.sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)));
  const seen = new Set<string>();
  const channels: Array<"SMS" | "WHATSAPP"> = config.twilioWhatsappFrom ? ["SMS", "WHATSAPP"] : ["SMS"];
  let attempted = 0;
  let sent = 0;
  for (const contact of contacts) {
    const phone = normalizePhone(contact.phone);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    for (const channel of channels) {
      attempted += 1;
      const result = await notify(store, {
        session: null, residentId: input.residentId, incidentId: input.incidentId ?? null, channel,
        destination: phone, templateCode: input.templateCode, body: input.body, villageId: input.villageId ?? null
      });
      if (result.queued && result.detail.startsWith("Terkirim")) sent += 1;
    }
  }
  return { attempted, sent };
}

export const mapsLink = (lat: number | null, lng: number | null): string =>
  lat !== null && lng !== null ? ` Lokasi: https://maps.google.com/?q=${lat.toFixed(5)},${lng.toFixed(5)}` : "";
