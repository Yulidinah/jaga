import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { buildRouter } from "./api/index.js";
import { applyPlatformSettings } from "./api/platform-api.js";
import { notify } from "./audit.js";
import { authenticateDevice, authenticateGateway, resolveSession, usingEphemeralSessionSecret } from "./auth.js";
import { config, projectRoot } from "./config.js";
import { HttpError, json, nowIso, readBody } from "./lib.js";
import { addSubscriber, publish } from "./realtime.js";
import { createStore } from "./store-boot.js";
import type { Store } from "./store.js";
import type { Row, Session } from "./types.js";

/* ------------------------------------------------------ Aset web statis */

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".glb": "model/gltf-binary"
};

/**
 * Allowlist aset. Hanya nama berkas di bawah yang boleh dilayani.
 * .env, package.json, node_modules, backend, supabase, dan android tidak pernah
 * diakses karena tidak ada di daftar ini.
 */
const STATIC_FILES: Record<string, string> = {
  // Halaman depan publik; dashboard (butuh masuk) berada di /app.
  "/": "landing.html",
  "/landing.css": "landing.css",
  "/landing.js": "landing.js",
  "/jaga3d.js": "jaga3d.js",
  "/app": "index.html",
  "/index.html": "index.html",
  "/login": "login.html",
  "/login.html": "login.html",
  "/app.js": "app.js",
  "/auth.js": "auth.js",
  "/api-client.js": "api-client.js",
  "/styles.css": "styles.css",
  "/auth.css": "auth.css",
  "/manifest.webmanifest": "manifest.webmanifest",
  "/logo_jaga.jpeg": "logo_jaga.jpeg",
  "/service-worker.js": "service-worker.js",
  "/firebase-bridge.js": "firebase-bridge.js"
};

const STATIC_DIRS: Record<string, string> = {
  "/assets/": "assets",
  "/vendor/": "vendor"
};

/** Seluruh aset antarmuka berada di folder frontend/. */
const webRoot = resolve(projectRoot, "frontend");

const ALLOWED_EXTENSIONS = new Set(Object.keys(CONTENT_TYPES));

const resolveStatic = async (pathname: string): Promise<{ file: string; type: string } | null> => {
  const direct = STATIC_FILES[pathname];
  if (direct) {
    const file = resolve(webRoot, direct);
    if (!file.startsWith(webRoot + sep)) return null;
    return { file, type: CONTENT_TYPES[extname(file)] ?? "application/octet-stream" };
  }
  for (const [prefix, dir] of Object.entries(STATIC_DIRS)) {
    if (!pathname.startsWith(prefix)) continue;
    const relative = normalize(pathname.slice(prefix.length)).replace(/^([/\\])+/, "");
    if (!relative || relative.includes("..")) return null;
    if (!ALLOWED_EXTENSIONS.has(extname(relative))) return null;
    const file = resolve(webRoot, dir, relative);
    if (!file.startsWith(join(webRoot, dir) + sep)) return null;
    return { file, type: CONTENT_TYPES[extname(relative)] ?? "application/octet-stream" };
  }
  return null;
};

const inariskHost = (() => { try { return config.inariskWmsUrl ? new URL(config.inariskWmsUrl).origin : ""; } catch { return ""; } })();
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://ajax.googleapis.com https://www.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  `img-src 'self' data: https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://server.arcgisonline.com https://cdn.rawgit.com https://cdnjs.cloudflare.com${inariskHost ? ` ${inariskHost}` : ""}`,
  `connect-src 'self' https://router.project-osrm.org https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://server.arcgisonline.com https://api.open-meteo.com https://cdn.jsdelivr.net https://*.firebasedatabase.app wss://*.firebasedatabase.app`,
  "font-src 'self' data: https://fonts.gstatic.com",
  "media-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

const serveStatic = async (res: ServerResponse, pathname: string): Promise<boolean> => {
  const target = await resolveStatic(pathname);
  if (!target) return false;
  try {
    const info = await stat(target.file);
    if (!info.isFile()) return false;
    const body = await readFile(target.file);
    const immutable = pathname.startsWith("/vendor/") || pathname.startsWith("/assets/");
    res.writeHead(200, {
      "content-type": target.type,
      "content-length": body.length,
      "cache-control": immutable ? "public, max-age=300" : "no-cache",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "content-security-policy": CSP
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
};

/* ------------------------------------------------------------ Server */

const store: Store = await createStore().catch(error => {
  console.error(`[jaga] ${(error as Error).message}`);
  process.exit(1);
});
const router = buildRouter();
await applyPlatformSettings(store).catch(() => undefined); // pengaturan Pusat (mis. batas offline kalung)

const DEVICE_ROUTES = ["/api/device/telemetry", "/api/device/location", "/api/device/inbox", "/api/device/sos", "/api/device/receipts/"];

const securityHeaders = (res: ServerResponse) => {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("permissions-policy", "geolocation=(self), microphone=()");
  res.setHeader("cross-origin-opener-policy", "same-origin");
};

const sendError = (res: ServerResponse, error: unknown) => {
  if (res.headersSent) { res.end(); return; }
  if (error instanceof HttpError) {
    json(res, error.status, { error: error.message, detail: error.detail ?? undefined });
    return;
  }
  console.error("[jaga] kesalahan tidak tertangani:", error);
  json(res, 500, { error: "Terjadi kesalahan pada server" });
};

const handleStream = async (req: IncomingMessage, res: ServerResponse) => {
  const session = await resolveSession(store, req);
  if (!session) throw new HttpError(401, "Sesi tidak valid atau sudah berakhir");
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-content-type-options": "nosniff"
  });
  res.write(`retry: 5000\n\n`);
  res.write(`event: connected\ndata: ${JSON.stringify({ at: new Date().toISOString(), role: session.role })}\n\n`);
  const unsubscribe = addSubscriber(res, session);
  req.on("close", unsubscribe);
  req.on("error", unsubscribe);
};

const handleDeviceRequest = async (req: IncomingMessage, url: URL) => {
  const method = (req.method ?? "GET").toUpperCase();
  const body = method === "GET" ? {} : await readBody(req, 64 * 1024);
  // Kunci gateway bersifat opsional: perangkat yang terhubung langsung tidak memakai gateway.
  const gateway = req.headers["x-jaga-gateway-key"] ? await authenticateGateway(store, req, url) : undefined;
  const deviceAuth = await authenticateDevice(store, req, url);
  return { body, gateway, deviceAuth, device: deviceAuth.device };
};

const server = createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const method = (req.method ?? "GET").toUpperCase();

  try {
    if (url.pathname === "/api/stream" && method === "GET") {
      await handleStream(req, res);
      return;
    }

    if (DEVICE_ROUTES.some(route => url.pathname === route || (route.endsWith("/") && url.pathname.startsWith(route)))) {
      const extra = await handleDeviceRequest(req, url);
      const session = (await resolveSession(store, req)) ?? deviceSession(extra.device);
      await router.handle(req, res, store, () => Promise.resolve(session), { extra });
      return;
    }

    if (url.pathname === "/api/iot/test" && method === "GET") {
      const start = Date.now();
      try {
        const resp = await fetch("https://jaga-51a35-default-rtdb.asia-southeast1.firebasedatabase.app/kalung/JAGA-052.json");
        const data = await resp.json();
        const latencyMs = Date.now() - start;
        json(res, 200, { success: true, latencyMs, status: "CONNECTED", deviceId: "JAGA-052", data });
      } catch (err: any) {
        json(res, 502, { success: false, status: "DISCONNECTED", error: err?.message || "Gagal menghubungi Firebase RTDB" });
      }
      return;
    }

    if (url.pathname === "/api/iot/status" && method === "GET") {
      try {
        const resp = await fetch("https://jaga-51a35-default-rtdb.asia-southeast1.firebasedatabase.app/kalung/JAGA-052.json");
        const data = await resp.json();
        json(res, 200, { success: true, deviceId: "JAGA-052", data, timestamp: Date.now() });
      } catch (err: any) {
        json(res, 502, { success: false, error: err?.message || "Gagal menghubungi Firebase RTDB" });
      }
      return;
    }

    if (url.pathname === "/api/iot/alarm" && method === "POST") {
      try {
        const body = (await readBody(req, 16 * 1024)) as { status?: string };
        const status = body.status === "DARURAT" ? "DARURAT" : (body.status === "SIAGA" ? "SIAGA" : "AMAN");
        const payload = status === "DARURAT"
          ? { status_alarm: "DARURAT", sos: true, siaga: false, aman: false, last_active: Date.now() }
          : status === "SIAGA"
            ? { status_alarm: "SIAGA", sos: false, siaga: true, aman: false, last_active: Date.now() }
            : { status_alarm: "AMAN", sos: false, siaga: false, aman: true, last_active: Date.now() };

        const resp = await fetch("https://jaga-51a35-default-rtdb.asia-southeast1.firebasedatabase.app/kalung/JAGA-052.json", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await resp.json();
        publish("device.updated", { deviceId: "JAGA-052", status, data });
        json(res, 200, { success: true, deviceId: "JAGA-052", status, updated: data });
      } catch (err: any) {
        json(res, 500, { success: false, error: err?.message || "Gagal mengirim status ke Firebase" });
      }
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await router.handle(req, res, store, req0 => resolveSession(store, req0));
      return;
    }

    if (method === "GET" || method === "HEAD") {
      if (await serveStatic(res, url.pathname)) return;
    }
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><meta charset=\"utf-8\"><title>404</title><p>Halaman tidak ditemukan.</p>");
  } catch (error) {
    sendError(res, error);
  }
});

/** Perangkat tidak punya sesi, tetapi tetap mendapat sesi terbatas agar kontrak Ctx terpenuhi. */
const deviceSession = (device: Row): Session => ({
  userId: `device:${device.id}`,
  profileId: `device:${device.id}`,
  displayName: `Perangkat ${device.id}`,
  email: "",
  role: "RESCUE",
  organizationId: null,
  organizationName: null,
  villageIds: device.village_id ? [String(device.village_id)] : null,
  villageNames: [],
  authSource: "internal",
  expiresAt: Date.now() + 60_000
});

server.listen(config.port, () => {
  console.log(`[jaga] server berjalan di http://localhost:${config.port}`);
  console.log(`[jaga] penyimpanan: ${store.kind === "supabase" ? "Supabase" : "memori (data demo)"}`);
  if (usingEphemeralSessionSecret) {
    console.warn("[jaga] SESSION_SECRET belum disetel, sesi akan berakhir setiap restart.");
  }
  if (config.devRoleHeader) {
    console.warn("[jaga] JAGA_DEV_ROLE_HEADER aktif. Jangan pakai di lingkungan produksi.");
  }
  publish("connected", { storage: store.kind });

  // Mode memori/demo: kalung "online" pada data demo tidak punya perangkat nyata yang mengirim sinyal, jadi sinyalnya
  // diperbarui berkala supaya tidak otomatis tampil offline. Matikan dengan JAGA_DEMO_HEARTBEAT=false.
  // Di Supabase, detak ini hanya aktif bila JAGA_DEMO_HEARTBEAT=true (demo tanpa kalung asli); jangan dipakai bersama kalung sungguhan.
  const demoHeartbeat = store.kind === "memory" ? process.env.JAGA_DEMO_HEARTBEAT !== "false" : process.env.JAGA_DEMO_HEARTBEAT === "true";
  if (demoHeartbeat) {
    const beat = async () => {
      try {
        const devices = await store.list("devices", { eq: { online: true } });
        for (const device of devices) await store.update("devices", String(device.id), { last_seen_at: nowIso(), ...(device.location_at ? { location_at: nowIso() } : {}) });
      } catch (error) { console.warn("[jaga] detak demo gagal:", (error as Error).message); }
    };
    void beat();
    const heartbeat = setInterval(beat, 5 * 60_000);
    heartbeat.unref();
  }

  // Sinkronisasi dua arah real-time dengan Kalung Fisik ESP32 via Firebase RTDB
  const FIREBASE_IOT_URL = "https://jaga-51a35-default-rtdb.asia-southeast1.firebasedatabase.app/kalung/JAGA-052.json";
  let lastKnownEspStatus = "AMAN";

  const syncEsp32Hardware = async () => {
    try {
      const resp = await fetch(FIREBASE_IOT_URL, { signal: AbortSignal.timeout(4000) });
      if (!resp.ok) return;
      const data = (await resp.json()) as any;
      if (!data) return;

      const rawStatus = String(data.status_alarm || (data.sos ? "DARURAT" : (data.siaga ? "SIAGA" : "AMAN"))).toUpperCase();
      const isSos = data.sos === true || rawStatus === "DARURAT";
      const isAman = (data.aman === true || rawStatus === "AMAN") && !isSos;

      // 1. Kalung ESP32 Ditekan Teman / SOS Aktif
      if (isSos && lastKnownEspStatus !== "DARURAT") {
        lastKnownEspStatus = "DARURAT";
        const dev = await store.one("devices", { eq: { id: "JAGA-052" } });
        const resId = dev?.resident_id;
        const resident = resId ? await store.one("residents", { eq: { id: String(resId) } }) : null;
        const vId = dev?.village_id || resident?.village_id;

        const openIncident = await store.one("incidents", {
          eq: { device_id: "JAGA-052" },
          pred: row => !["SAFE", "CANCELLED", "CLOSED"].includes(String(row.status))
        });

        const lat = Number(data.lat ?? dev?.latitude ?? -5.54829);
        const lng = Number(data.lng ?? dev?.longitude ?? 95.323753);
        const now = nowIso();

        if (!openIncident) {
          const newInc = await store.insert("incidents", {
            resident_id: resident?.id ?? null,
            village_id: vId ?? null,
            device_id: "JAGA-052",
            owner_name: resident?.full_name ?? "Hj. Siti Aminah",
            status: "NEW",
            severity: "AWAS",
            disaster_type: "SOS Kalung Fisik ESP32",
            description: "Tombol SOS ditekan pada kalung fisik JAGA-052",
            latitude: lat,
            longitude: lng,
            created_at: now
          });

          await notify(store, {
            session: null,
            incidentId: String(newInc.id),
            channel: "IN_APP",
            destination: String(vId ?? ""),
            templateCode: "SOS",
            villageId: vId ? String(vId) : null,
            body: `🚨 SOS dari Kalung Fisik JAGA-052 (${resident?.full_name ?? "Hj. Siti Aminah"})! Koordinat: ${lat.toFixed(5)}, ${lng.toFixed(5)}`
          });
          publish("sos.created", { id: newInc.id, deviceId: "JAGA-052", residentId: resident?.id, severity: "AWAS", status: "NEW", latitude: lat, longitude: lng }, vId ? String(vId) : undefined);
        }

        await store.update("devices", "JAGA-052", {
          online: true,
          latitude: lat,
          longitude: lng,
          last_seen_at: now,
          status: "ASSIGNED"
        });
        publish("device.updated", { deviceId: "JAGA-052", status: "DARURAT", state: "BANTUAN", online: true, latitude: lat, longitude: lng }, vId ? String(vId) : undefined);
        console.log("[JAGA IoT Sync] Sinyal SOS terdeteksi dari kalung fisik JAGA-052");
      }

      // 2. Kalung ESP32 Dimatikan Teman / Reset ke AMAN
      else if (isAman && lastKnownEspStatus === "DARURAT") {
        lastKnownEspStatus = "AMAN";
        const openIncidents = await store.list("incidents", {
          eq: { device_id: "JAGA-052" },
          pred: row => !["SAFE", "CANCELLED", "CLOSED"].includes(String(row.status))
        });
        for (const inc of openIncidents) {
          await store.update("incidents", String(inc.id), { status: "SAFE" });
          publish("incident.updated", { id: inc.id, status: "SAFE" }, inc.village_id ? String(inc.village_id) : undefined);
        }
        await store.update("devices", "JAGA-052", {
          online: true,
          last_seen_at: nowIso(),
          status: "ASSIGNED"
        });
        publish("device.updated", { deviceId: "JAGA-052", status: "AMAN", state: "AMAN", online: true });
        console.log("[JAGA IoT Sync] Kalung fisik JAGA-052 dimatikan / reset ke AMAN");
      }
    } catch {
      // Abaikan kegagalan jaringan sementara
    }
  };

  const iotSyncInterval = setInterval(syncEsp32Hardware, 2500);
  iotSyncInterval.unref();
});

const shutdown = (signal: string) => {
  console.log(`[jaga] menerima ${signal}, menutup server`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export { server, store };
