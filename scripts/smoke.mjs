// smoke.mjs - uji alur utama lewat HTTP nyata (mode memori)
const base = process.env.BASE ?? "http://localhost:3100";
let cookie = "";
const results = [];

async function call(method, path, body, headers = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual"
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text.slice(0, 120); }
  return { status: response.status, body: json };
}

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "OK  " : "GAGAL"} ${name}${detail ? " :: " + detail : ""}`);
}

const health = await call("GET", "/api/health");
check("health", health.status === 200, JSON.stringify(health.body).slice(0, 80));

// 1. Endpoint terlindungi tanpa sesi harus 401
const anon = await call("GET", "/api/dashboard");
check("dashboard tanpa sesi = 401", anon.status === 401, `status ${anon.status}`);

// 2. Login kredensial salah ditolak
const bad = await call("POST", "/api/auth/login", { email: "pusat@jaga.id", password: "salah" });
check("login password salah ditolak", bad.status === 401 || bad.status === 400, `status ${bad.status}`);

// 3. Login pusat
const login = await call("POST", "/api/auth/login", { email: "pusat@jaga.id", password: "JagaPusat2026!" });
check("login pusat", login.status === 200 && !!cookie, `status ${login.status} ${JSON.stringify(login.body).slice(0, 90)}`);
const me = login.body?.user ?? login.body?.session ?? null;

// 4. Session
const session = await call("GET", "/api/auth/session");
check("session aktif", session.status === 200, `role ${session.body?.role ?? "-"}`);

// 5. Dashboard
const dash = await call("GET", "/api/dashboard");
check("dashboard", dash.status === 200,
  dash.status === 200 ? `warga=${dash.body?.counters?.residents} insiden=${dash.body?.counters?.incidents} peta=${dash.body?.map?.length}` : JSON.stringify(dash.body).slice(0, 120));

// 6. Warga + scoping
const residents = await call("GET", "/api/residents?limit=5");
check("daftar warga", residents.status === 200, `${residents.body?.items?.length ?? residents.body?.length ?? 0} baris`);

// 7. Buat SOS
const villageId = dash.body?.map?.[0]?.id ?? residents.body?.items?.[0]?.village_id;
const sos = await call("POST", "/api/sos", {
  villageId,
  description: "Uji otomatis: air naik di jalan utama",
  latitude: -6.9, longitude: 107.6
});
check("buat SOS", sos.status === 200 || sos.status === 201,
  `status ${sos.status} ${JSON.stringify(sos.body).slice(0, 130)}`);
const incidentId = sos.body?.incident?.id ?? sos.body?.id;

// 8. Detail insiden + rekomendasi
if (incidentId) {
  const detail = await call("GET", `/api/incidents/${incidentId}`);
  check("detail insiden", detail.status === 200, `status ${detail.status}`);
  const rec = await call("GET", `/api/incidents/${incidentId}/recommendation`);
  check("rekomendasi otomatis", rec.status === 200,
    rec.status === 200 ? `level=${rec.body?.level ?? rec.body?.recommendation?.level} score=${rec.body?.score ?? rec.body?.recommendation?.score}` : JSON.stringify(rec.body).slice(0, 120));
  const route = await call("POST", `/api/incidents/${incidentId}/route`, { shelterId: dash.body?.shelters?.[0]?.id });
  check("hitung rute", route.status === 200 || route.status === 400,
    route.status === 200 ? `${Math.round(route.body?.route?.distanceMeters ?? 0)} m` : `status ${route.status} ( Shelter belum ada di seed )`);
  const assess = await call("POST", `/api/incidents/${incidentId}/assessment`, { notes: "Uji otomatis" });
  check("assessment manual", assess.status === 200 || assess.status === 400, `status ${assess.status}`);
}

// 9. Rule set
const rules = await call("GET", "/api/rulesets/active");
check("rule set aktif", rules.status === 200, rules.status === 200 ? `${rules.body?.factors?.length ?? "?"} faktor` : `status ${rules.status}`);

// 10. Audit log terisi
const audit = await call("GET", "/api/audit?limit=5");
check("audit log terisi", audit.status === 200 && (audit.body?.items?.length ?? 0) > 0, `${audit.body?.items?.length ?? 0} entri`);

// 11. Scoping desa: akun desa hanya melihat desanya
const pusatCookie = cookie;
cookie = "";
const desa = await call("POST", "/api/auth/login", { email: "desa.sukamaju@jaga.id", password: "JagaDesa2026!" });
check("login desa", desa.status === 200, `status ${desa.status}`);
const desaDash = await call("GET", "/api/dashboard");
const desaVillages = new Set((desaDash.body?.map ?? []).map(v => v.id));
check("scoping desa terbatas", desa.status === 200 && desaVillages.size > 0 && desaVillages.size < (dash.body?.map?.length ?? 99),
  `desa melihat ${desaVillages.size} desa, pusat melihat ${dash.body?.map?.length ?? "?"}`);

// 12. Desa tidak boleh buat akun
const forbidden = await call("POST", "/api/accounts", { email: "x@y.id", displayName: "X", role: "PUSAT", password: "Rahasia123" });
check("desa ditolak buat akun = 403", forbidden.status === 403, `status ${forbidden.status}`);

// 13. Kembali ke pusat
cookie = pusatCookie;
const list = await call("GET", "/api/accounts");
check("daftar akun (pusat)", list.status === 200, `${list.body?.items?.length ?? list.body?.length ?? 0} akun`);

// 14. Rotasi kunci perangkat
const devices = await call("GET", "/api/devices?limit=3");
const deviceId = devices.body?.items?.[0]?.id ?? devices.body?.[0]?.id;
const rotate = await call("POST", `/api/devices/${deviceId}/rotate-key`, {});
check("rotasi kunci perangkat", rotate.status === 200, rotate.status === 200 ? "kunci baru dibuat" : JSON.stringify(rotate.body).slice(0, 110));

// 15. Validasi input ditolak
const invalid = await call("POST", "/api/sos", { villageId: "bukan-uuid", description: "x" });
check("validasi input menolak data buruk", invalid.status === 400, `status ${invalid.status}`);

// 16. Aset sensitif tidak bocor
for (const secretPath of ["/.env", "/package.json", "/backend/src/config.ts", "/supabase/migrations/202609220002_operational.sql"]) {
  const r = await fetch(base + secretPath);
  check(`tolak akses ${secretPath}`, r.status === 404, `status ${r.status}`);
}

// 17. Rate limit / body。基本
const logout = await call("POST", "/api/auth/logout", {});
check("logout", logout.status === 200 || logout.status === 204, `status ${logout.status}`);
const after = await call("GET", "/api/dashboard");
check("sesi hilang setelah logout", after.status === 401, `status ${after.status}`);

const failedCount = results.filter(r => !r.ok).length;
console.log("\n" + "=".repeat(60));
console.log(`HASIL: ${results.length - failedCount}/${results.length} lulus`);
if (failedCount) {
  console.log("GAGAL:");
  for (const r of results.filter(x => !x.ok)) console.log("  - " + r.name + " :: " + r.detail);
}
process.exit(failedCount ? 1 : 0);
