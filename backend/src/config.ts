import { resolve } from "node:path";

// Backend dijalankan dari akar proyek; path aset web ikut di sana.
export const projectRoot = resolve(process.cwd());

const num = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const bool = (value: string | undefined) => value === "1" || value?.toLowerCase() === "true";

export const config = {
  port: num(process.env.PORT, 3000),
  env: process.env.NODE_ENV ?? "development",
  projectRoot,

  supabaseUrl: process.env.SUPABASE_URL?.replace(/\/$/, "") ?? "",
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY ?? "",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? "",

  sessionSecret: process.env.SESSION_SECRET ?? "",
  sessionTtlSeconds: num(process.env.SESSION_TTL_SECONDS, 60 * 60 * 12),
  secureCookie: bool(process.env.SECURE_COOKIE),

  /** Izinkan header X-JAGA-Role tanpa token. Hanya untuk pengembangan lokal. */
  devRoleHeader: bool(process.env.JAGA_DEV_ROLE_HEADER),

  mqttUrl: process.env.MQTT_URL ?? "",
  mqttUsername: process.env.MQTT_USERNAME ?? "",
  mqttPassword: process.env.MQTT_PASSWORD ?? "",

  fcmServerKey: process.env.FCM_SERVER_KEY ?? "",
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",

  /** Batas jumlah baris yang boleh dikirim ke klien dalam satu permintaan daftar. */
  maxPageSize: num(process.env.MAX_PAGE_SIZE, 1000),

  /** Perangkat/gateway dianggap offline bila tidak mengirim sinyal selama sekian menit. */
  deviceOfflineMinutes: num(process.env.DEVICE_OFFLINE_MINUTES, 15)
} as const;

export const supabaseEnabled = Boolean(config.supabaseUrl && config.supabaseSecretKey);
