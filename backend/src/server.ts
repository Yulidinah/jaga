import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { buildRouter } from "./api/index.js";
import { applyPlatformSettings } from "./api/platform-api.js";
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
  ".txt": "text/plain; charset=utf-8"
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
  "/service-worker.js": "service-worker.js"
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

const inariskHost = (() => { try { return config.inariskWmsUrl ? new URL(config.inariskWmsUrl).origin : ""; } catch { return ""; } })();
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  `img-src 'self' data: https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://server.arcgisonline.com${inariskHost ? ` ${inariskHost}` : ""}`,
  `connect-src 'self' https://router.project-osrm.org https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://server.arcgisonline.com`,
  "font-src 'self' data: https://fonts.gstatic.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

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
});

const shutdown = (signal: string) => {
  console.log(`[jaga] menerima ${signal}, menutup server`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export { server, store };
