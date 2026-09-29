import { config, supabaseEnabled } from "./config.js";
import { nowIso, randomToken } from "./lib.js";
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
    actor_id: input.actorId,
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
  if (supabaseEnabled) {
    try {
      await store.insert("audit_logs", entry);
    } catch (error) {
      console.warn("[audit] gagal menyimpan audit log:", (error as Error).message);
    }
  }
}

export const actorOf = (session: Session | null): string | null => session?.profileId ?? null;

export const recentAudit = (limit = 50): Array<Row & { at: string }> => ring.slice(0, Math.min(limit, RING_LIMIT));

/* ------------------------------------------------------------- Notifikasi */

export interface NotifyInput {
  session: Session | null;
  incidentId?: string | null;
  residentId?: string | null;
  channel: "PUSH" | "SMS" | "WHATSAPP" | "EMAIL";
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
 * Tulis antrean notifikasi. Pengiriman nyata memerlukan kredensial FCM/Twilio
 * pada .env; tanpa itu antrean tetap dicatat agar bisa diproses manual.
 */
export async function notify(store: Store, input: NotifyInput): Promise<NotifyResult> {
  const notificationId = randomToken(12);
  const providerKey = input.channel === "PUSH" ? config.fcmServerKey
    : input.channel === "SMS" || input.channel === "WHATSAPP" ? config.twilioAuthToken
    : "";
  const provider = input.channel === "PUSH" ? "fcm" : input.channel === "EMAIL" ? "smtp" : "twilio";

  await store.insert("notifications", {
    id: notificationId,
    profile_id: input.session?.profileId ?? null,
    incident_id: input.incidentId ?? null,
    channel: input.channel,
    title: input.templateCode,
    body: input.body,
    destination: input.destination,
    template_code: input.templateCode,
    status: "QUEUED",
    created_at: nowIso()
  }).catch(error => console.warn("[notify] gagal membuat antrean:", (error as Error).message));

  if (!providerKey) {
    return {
      queued: true,
      provider,
      detail: `Antrean dibuat. Kredensial ${provider.toUpperCase()} belum diatur, sehingga pesan belum dikirim.`,
      notificationId
    };
  }

  try {
    if (provider === "fcm") {
      const response = await fetch("https://fcm.googleapis.com/fcm/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `key=${config.fcmServerKey}` },
        body: JSON.stringify({ to: input.destination, notification: { title: "JAGA", body: input.body } })
      });
      if (!response.ok) throw new Error(`FCM ${response.status}`);
      await store.update("notifications", { eq: { id: notificationId } }, { status: "SENT", sent_at: nowIso() });
      return { queued: true, provider, detail: "Terkirim melalui FCM.", notificationId };
    }
    if (provider === "twilio") {
      const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64");
      const form = new URLSearchParams({ To: input.destination, From: process.env.TWILIO_FROM_NUMBER ?? "", Body: input.body });
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString()
      });
      if (!response.ok) throw new Error(`Twilio ${response.status}`);
      await store.update("notifications", { eq: { id: notificationId } }, { status: "SENT", sent_at: nowIso() });
      return { queued: true, provider, detail: "Terkirim melalui Twilio.", notificationId };
    }
    throw new Error("Provider email belum diintegrasikan");
  } catch (error) {
    const message = (error as Error).message;
    await store.update("notifications", { eq: { id: notificationId } }, { status: "FAILED" }).catch(() => undefined);
    return { queued: false, provider, detail: `Pengiriman gagal: ${message}`, notificationId };
  }
}

