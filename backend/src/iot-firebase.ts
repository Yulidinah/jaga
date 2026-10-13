import { config } from "./config.js";

/**
 * Transport kalung ESP32 lewat Firebase Realtime Database (jalur /kalung/<ID perangkat>).
 * Format data yang ditulis/dibaca firmware tidak diubah: status_alarm, sos, siaga, aman, lat, lng, last_active.
 *
 * Seluruh akses dari backend lewat modul ini. Bila FIREBASE_RTDB_SECRET diisi, setiap permintaan membawa
 * ?auth=<secret> sehingga rules RTDB bisa dikunci tanpa memutus backend.
 */

export type AlarmState = "AMAN" | "SIAGA" | "DARURAT";

const base = () => config.firebaseRtdbUrl.replace(/\/$/, "");
export const firebaseEnabled = () => Boolean(config.firebaseRtdbUrl) && config.iotSync;

const urlFor = (path: string) => {
  const secret = config.firebaseRtdbSecret;
  return `${base()}/${path.replace(/^\//, "")}.json${secret ? `?auth=${encodeURIComponent(secret)}` : ""}`;
};

const stateFlags = (state: AlarmState) => ({
  status_alarm: state,
  sos: state === "DARURAT",
  siaga: state === "SIAGA",
  aman: state === "AMAN",
  last_active: Date.now()
});

export async function rtdbGet<T = unknown>(path: string, timeoutMs = 4000): Promise<T | null> {
  if (!firebaseEnabled()) return null;
  const response = await fetch(urlFor(path), { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Firebase RTDB ${response.status}`);
  return (await response.json()) as T | null;
}

export async function rtdbPatch(path: string, body: Record<string, unknown>, timeoutMs = 4000): Promise<unknown> {
  if (!firebaseEnabled()) return null;
  const response = await fetch(urlFor(path), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`Firebase RTDB ${response.status}`);
  return response.json();
}

export const deviceNode = (deviceId: string) => `kalung/${encodeURIComponent(deviceId)}`;

/**
 * Status yang terakhir ditulis backend per kalung. Sinkronisasi memakainya agar alarm dari operator
 * (yang ikut menulis sos=true ke RTDB) tidak dibaca sebagai tombol SOS yang ditekan warga.
 */
const pushed = new Map<string, AlarmState>();
export const isBackendEcho = (deviceId: string, state: AlarmState) => pushed.get(deviceId) === state;
export const clearBackendEcho = (deviceId: string) => { pushed.delete(deviceId); };

/** Kirim status alarm ke satu kalung. Mengembalikan false bila transport mati atau gagal. */
export async function pushAlarm(deviceId: string, state: AlarmState): Promise<boolean> {
  if (!firebaseEnabled()) return false;
  try {
    await rtdbPatch(deviceNode(deviceId), stateFlags(state));
    pushed.set(deviceId, state);
    return true;
  } catch (error) {
    console.warn(`[iot] gagal mengirim alarm ke ${deviceId}:`, (error as Error).message);
    return false;
  }
}

/** Semua kalung yang terdaftar di RTDB: { [id]: data }. */
export async function listRtdbDevices(): Promise<Record<string, Record<string, unknown>>> {
  const all = await rtdbGet<Record<string, unknown>>("kalung");
  const result: Record<string, Record<string, unknown>> = {};
  for (const [id, value] of Object.entries(all ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) result[id] = value as Record<string, unknown>;
  }
  return result;
}

export const stateOf = (data: Record<string, unknown>): AlarmState => {
  const raw = String(data.status_alarm ?? (data.sos ? "DARURAT" : data.siaga ? "SIAGA" : "AMAN")).toUpperCase();
  if (data.sos === true || raw === "DARURAT") return "DARURAT";
  if (raw === "SIAGA" || data.siaga === true) return "SIAGA";
  return "AMAN";
};

/** Kirim alarm hanya ke kalung yang memang terdaftar di RTDB (tidak membuat node baru untuk perangkat lain). */
export async function pushAlarmToKnown(deviceIds: string[], state: AlarmState): Promise<string[]> {
  if (!firebaseEnabled() || !deviceIds.length) return [];
  let known: Record<string, unknown>;
  try { known = await listRtdbDevices(); } catch (error) {
    console.warn("[iot] daftar kalung RTDB tidak terbaca:", (error as Error).message);
    return [];
  }
  const targets = deviceIds.filter(id => id in known);
  const results = await Promise.all(targets.map(async id => ((await pushAlarm(id, state)) ? id : null)));
  return results.filter((id): id is string => id !== null);
}
