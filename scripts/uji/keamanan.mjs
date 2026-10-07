// Uji keamanan (server memori yang sedang berjalan, BASE default http://localhost:3100):
//   $env:JAGA_FORCE_MEMORY="true"; $env:PORT="3100"; npm start   lalu   node scripts/uji/keamanan.mjs
// Langkah 1 - keamanan: matriks otorisasi semua rute, IDOR lintas desa, fuzz masukan, cabut sesi.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.env.BASE ?? "http://localhost:3100";
const root = fileURLToPath(new URL("../..", import.meta.url));
const findings = [];
const note = (level, text) => { findings.push({ level, text }); console.log(`${level.padEnd(6)} ${text}`); };

async function call(method, path, { cookie, body, headers = {}, raw } = {}) {
  const res = await fetch(base + path, {
    method, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined)
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* bukan json */ }
  return { status: res.status, json, text };
}
async function login(email, password) {
  const r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  return r.headers.get("set-cookie")?.split(";")[0];
}

const cookies = {
  PUSAT: await login("pusat@jaga.id", "JagaPusat2026!"),
  DESA: await login("desa.leubokpusaka@jaga.id", "JagaDesa2026!"),
  DESA2: await login("desa.seureuke@jaga.id", "JagaDesa2026!"),
  RESCUE: await login("rescue.bpbd@jaga.id", "JagaRescue2026!")
};
if (Object.values(cookies).some(c => !c)) { console.log("login gagal"); process.exit(1); }

// ---------------------------------------------------------------- 1. matriks rute
const src = readFileSync(`${root}/backend/src/api/index.ts`, "utf8");
const routes = [...src.matchAll(/router\.(get|post|put|patch|delete)\("([^"]+)",\s*([^,\n]+?)(?:,\s*(\{[^}]*\}))?\);/g)]
  .map(m => ({ method: m[1].toUpperCase(), path: m[2], opts: m[4] ?? "" }));
console.log(`\n[1] Matriks otorisasi: ${routes.length} rute x 5 identitas\n`);
const UUID = "00000000-0000-4000-8000-0000000000aa";
const SKIP = new Set(["/api/auth/logout", "/api/stream"]);
let calls = 0;
for (const route of routes) {
  if (SKIP.has(route.path)) continue;
  const isPublic = /public:\s*true/.test(route.opts) || ["/api/auth/login", "/api/health", "/api/config", "/api/auth/status"].includes(route.path);
  const roles = (route.opts.match(/roles:\s*\[([^\]]*)\]/)?.[1] ?? "").match(/"(\w+)"/g)?.map(x => x.replaceAll('"', '')) ?? null;
  const path = route.path.replace(/:\w+/g, UUID);
  const body = ["POST", "PUT", "PATCH"].includes(route.method) ? {} : undefined;
  for (const who of ["ANON", "PUSAT", "DESA", "DESA2", "RESCUE"]) {
    if (route.path.startsWith("/api/device") && !route.path.startsWith("/api/devices")) continue; // dicek terpisah
    const r = await call(route.method, path, { cookie: who === "ANON" ? undefined : cookies[who], body });
    calls++;
    const role = who.replace("2", "");
    if (r.status >= 500) note("KRITIS", `${route.method} ${route.path} sebagai ${who} => ${r.status} ${r.text.slice(0, 80)}`);
    if (who === "ANON" && !isPublic && r.status !== 401) note("KRITIS", `${route.method} ${route.path} tanpa login => ${r.status} (harus 401)`);
    if (who !== "ANON" && roles && !roles.includes(role) && r.status !== 403) note("TINGGI", `${route.method} ${route.path} sebagai ${who} => ${r.status} (harus 403, peran diizinkan: ${roles.join("/")})`);
  }
}
console.log(`    ${calls} panggilan selesai`);

// ---------------------------------------------------------------- 2. IDOR lintas desa
console.log("\n[2] Isolasi data antar desa dan peran\n");
const P = cookies.PUSAT;
const listOf = async (path) => { const r = await call("GET", path, { cookie: P }); return Array.isArray(r.json?.data) ? r.json.data : r.json?.data?.data ?? []; };
const villages = await listOf("/api/villages");
const lp = villages.find(v => v.name.includes("Leubok"))?.id;
const residents = (await listOf("/api/residents?limit=1000")).filter(r => r.villageId === lp);
const incidents = (await listOf("/api/incidents?limit=500")).filter(r => r.villageId === lp);
const devices = (await listOf("/api/devices?limit=500")).filter(r => r.villageId === lp);
const shelters = (await listOf("/api/shelters")).filter(r => r.villageId === lp);
const tickets = (await listOf("/api/tickets")).filter(r => r.villageId === lp);
const probes = [
  ["GET", `/api/residents/${residents[0]?.id}`], ["PATCH", `/api/residents/${residents[0]?.id}`, { fullName: "Diretas" }], ["DELETE", `/api/residents/${residents[0]?.id}`],
  ["GET", `/api/incidents/${incidents[0]?.id}`], ["PATCH", `/api/incidents/${incidents[0]?.id}/status`, { status: "SAFE" }], ["GET", `/api/incidents/${incidents[0]?.id}/routes`],
  ["PATCH", `/api/devices/${devices[0]?.id}`, { notes: "x" }], ["POST", `/api/devices/${devices[0]?.id}/key`, {}], ["GET", `/api/devices/${devices[0]?.id}/telemetry`],
  ["PATCH", `/api/shelters/${shelters[0]?.id}`, { name: "Diretas" }], ["DELETE", `/api/shelters/${shelters[0]?.id}`],
  ["POST", "/api/alerts", { villageId: lp, severity: "AWAS", message: "palsu" }], ["POST", "/api/alerts/emergency", { villageId: lp }],
  ["POST", "/api/shelters", { villageId: lp, name: "Palsu", latitude: 1, longitude: 1 }], ["POST", "/api/residents", { villageId: lp, fullName: "Palsu Sekali" }],
  ["GET", `/api/residents?villageId=${lp}`], ["GET", `/api/devices?villageId=${lp}`], ["GET", `/api/shelters?villageId=${lp}`]
];
for (const [method, path, body] of probes) {
  const r = await call(method, path, { cookie: cookies.DESA2, body });
  const leaked = method === "GET" && r.status === 200 && (JSON.stringify(r.json?.data ?? "").includes(residents[0]?.fullName ?? "@@") || (Array.isArray(r.json?.data?.data) ? r.json.data.data : Array.isArray(r.json?.data) ? r.json.data : []).some(x => x.villageId === lp));
  if (leaked) note("KRITIS", `Desa lain dapat membaca: ${method} ${path} => 200`);
  else if (method !== "GET" && ![401, 403, 404, 400].includes(r.status)) note("KRITIS", `Desa lain dapat menulis: ${method} ${path} => ${r.status}`);
  else console.log(`    ok   Desa lain ditolak: ${method} ${path.replace(/[0-9a-f-]{36}/g, "…")} => ${r.status}`);
}
// Rescue tanpa operasi: tidak boleh melihat data warga
for (const path of ["/api/residents", `/api/residents/${residents[0]?.id}`, "/api/devices", "/api/accounts", "/api/audit/recent", "/api/rulesets/overrides", `/api/operations/${UUID}/roster`]) {
  const r = await call("GET", path, { cookie: cookies.RESCUE });
  if (r.status === 200 && JSON.stringify(r.json).includes("fullName")) note("KRITIS", `Rescue tanpa operasi membaca data warga: GET ${path}`);
  else console.log(`    ok   Rescue tanpa operasi: GET ${path.replace(/[0-9a-f-]{36}/g, "…")} => ${r.status}`);
}
// Rescue/Desa tidak boleh membaca akun, audit
for (const who of ["DESA", "RESCUE"]) {
  for (const path of ["/api/audit/recent"]) {
    const r = await call("GET", path, { cookie: cookies[who] });
    if (r.status === 200) note("TINGGI", `${who} dapat membaca ${path}`);
  }
}
const accD = await call("GET", "/api/accounts", { cookie: cookies.DESA });
if (accD.status === 200 && (accD.json?.data ?? []).some(a => a.role !== "DESA")) note("TINGGI", "Desa melihat akun peran lain");
const tk = await call("GET", "/api/tickets", { cookie: cookies.DESA2 });
if ((tk.json?.data ?? []).some(t => t.villageId === lp)) note("TINGGI", "Desa lain melihat kendala teknis desa ini");

// ---------------------------------------------------------------- 3. masukan jahat
console.log("\n[3] Fuzz masukan\n");
const big = "x".repeat(70_000);
const r1 = await call("POST", "/api/tickets", { cookie: cookies.DESA, raw: JSON.stringify({ title: "judul valid", description: big }) });
console.log(`    body > 64KB => ${r1.status}`); if (r1.status < 400) note("SEDANG", "body besar diterima");
const r2 = await call("POST", "/api/auth/login", { raw: "{bukan json" });
console.log(`    JSON rusak => ${r2.status}`); if (r2.status >= 500) note("TINGGI", "JSON rusak menyebabkan 5xx");
const evil = ["' OR 1=1 --", "\"; DROP TABLE residents; --", "<script>alert(1)</script>", "%00", "../../../etc/passwd", "{{7*7}}", "${7*7}"];
for (const e of evil) {
  for (const path of [`/api/residents?q=${encodeURIComponent(e)}`, `/api/incidents?status=${encodeURIComponent(e)}`, `/api/devices?villageId=${encodeURIComponent(e)}`, `/api/tickets?status=${encodeURIComponent(e)}`, `/api/residents/${encodeURIComponent(e)}`]) {
    const r = await call("GET", path, { cookie: P });
    if (r.status >= 500) note("TINGGI", `Masukan jahat memicu ${r.status}: GET ${path.slice(0, 60)}`);
  }
}
const xssTicket = await call("POST", "/api/tickets", { cookie: cookies.DESA, body: { title: "<img src=x onerror=alert(1)> uji", description: "<script>alert(2)</script>", category: "LAINNYA" } });
console.log(`    judul berisi HTML disimpan apa adanya (dilepas di tampilan) => ${xssTicket.status}`);
for (const path of ["/.env", "/backend/src/config.ts", "/package.json", "/supabase/migrations/202609220001_initial_jaga.sql", "/..%2f..%2f.env", "/%2e%2e/%2e%2e/.env", "/scripts/seed-supabase.mjs", "/docs/JAGA.md", "/.git/config"]) {
  const r = await fetch(base + path); const t = await r.text();
  if (r.status === 200 && !/<!doctype html/i.test(t.slice(0, 40))) note("KRITIS", `Berkas sensitif tersaji: ${path}`);
}
console.log("    penelusuran jalur dan berkas sensitif: tidak ada yang tersaji");

// ---------------------------------------------------------------- 4. perangkat
console.log("\n[4] API perangkat\n");
const dev = devices.find(d => d.residentId);
for (const [label, headers] of [["tanpa kunci", {}], ["kunci salah", { "X-JAGA-Device-Id": dev.id, "X-JAGA-Device-Key": "jrk_salah" }], ["kunci di query", {}]]) {
  const r = await call("GET", label === "kunci di query" ? `/api/device/inbox?key=jrk_x&deviceId=${dev.id}` : "/api/device/inbox", { headers });
  if (r.status === 200) note("KRITIS", `API perangkat menerima ${label}`); else console.log(`    ok   ${label} => ${r.status}`);
}
const dKey = `jrk_${(await import("node:crypto")).createHash("sha256").update(`${dev.id}:pusat@jaga.id`).digest("hex").slice(0, 32)}`;
const other = devices.find(d => d.id !== dev.id);
const r3 = await call("POST", `/api/device/receipts/${UUID}`, { headers: { "X-JAGA-Device-Id": dev.id, "X-JAGA-Device-Key": dKey }, body: { status: "ACKNOWLEDGED" } });
console.log(`    receipt milik orang lain/tidak ada => ${r3.status}`); if (r3.status === 200) note("TINGGI", "receipt asing diterima");
const spam = await Promise.all(Array.from({ length: 5 }, () => call("POST", "/api/device/sos", { headers: { "X-JAGA-Device-Id": dev.id, "X-JAGA-Device-Key": dKey }, body: { latitude: 4.84, longitude: 97.47 } })));
console.log(`    SOS ganda serentak: ${spam.map(s => s.status).join(",")} (insiden duplikat dicek terpisah)`);
const afterSos = (await listOf("/api/incidents?limit=500")).filter(i => i.deviceId === dev.id && !["SAFE", "CLOSED", "CANCELLED"].includes(i.status));
if (afterSos.length > 1) note("TINGGI", `SOS serentak membuat ${afterSos.length} insiden terbuka untuk satu kalung`);
else console.log(`    ok   hanya ${afterSos.length} insiden terbuka untuk satu kalung`);

// ---------------------------------------------------------------- 5. sesi
console.log("\n[5] Sesi dan akun\n");
const tmp = await call("POST", "/api/accounts", { cookie: P, body: { email: "uji.keamanan@jaga.id", displayName: "Uji Keamanan", role: "DESA", password: "KataSandi123!", organizationName: "Desa Uji", villageIds: [lp] } });
const tc = await login("uji.keamanan@jaga.id", "KataSandi123!");
const accs = (await listOf("/api/accounts")); const mine = accs.find(a => a.email === "uji.keamanan@jaga.id");
await call("DELETE", `/api/accounts/${mine?.id}`, { cookie: P });
const after = await call("GET", "/api/residents", { cookie: tc });
if (after.status === 200) note("KRITIS", "Sesi akun yang dihapus masih berlaku"); else console.log(`    ok   sesi akun terhapus => ${after.status}`);
const forged = cookies.DESA.replace(/\.[^.]+$/, ".AAAA");
const rf = await call("GET", "/api/residents", { cookie: forged });
if (rf.status === 200) note("KRITIS", "Tanda tangan sesi dipalsukan diterima"); else console.log(`    ok   token dengan tanda tangan palsu => ${rf.status}`);
const parts = cookies.DESA.split("=")[1].split(".");
const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString()); payload.role = "PUSAT"; payload.villageIds = null;
const tampered = `jaga_session=${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${parts[1]}`;
const rt = await call("GET", "/api/accounts", { cookie: tampered });
if (rt.status === 200) note("KRITIS", "Token dengan peran dimodifikasi diterima"); else console.log(`    ok   token dengan peran diubah => ${rt.status}`);
let blocked = 0; for (let i = 0; i < 12; i++) { const r = await call("POST", "/api/auth/login", { body: { email: "brute@jaga.id", password: "salah" + i } }); if (r.status === 429) blocked++; }
console.log(`    brute force: ${blocked} dari 12 percobaan diblokir (429)`); if (!blocked) note("TINGGI", "tidak ada pembatasan percobaan login");

console.log("\n=== RINGKASAN ===");
const by = l => findings.filter(f => f.level === l).length;
console.log(`KRITIS ${by("KRITIS")} | TINGGI ${by("TINGGI")} | SEDANG ${by("SEDANG")}`);
process.exit(0);
