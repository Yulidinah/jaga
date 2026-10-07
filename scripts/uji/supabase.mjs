// Uji alur yang berlaku hanya di Supabase. MENULIS data uji ke database (jalankan seed --reset sesudahnya).
//   (seed dengan SEED_DEMO_PASSWORDS=true)  PORT=3100 node --env-file=.env backend/dist/server.js   lalu   node scripts/uji/supabase.mjs
// Uji alur yang hanya berlaku di mode Supabase (Auth, RLS lewat service role, jsonb, indeks unik operasi, kunci perangkat).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const base = process.env.BASE ?? "http://localhost:3100";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "OK   " : "GAGAL"} ${name}${detail ? " :: " + String(detail).slice(0, 200) : ""}`); };
const sha = v => createHash("sha256").update(v).digest("hex");
async function call(method, path, { cookie, body, headers = {} } = {}) {
  const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* bukan json */ }
  return { status: res.status, data: json?.data, error: json?.error, headers: res.headers };
}
async function login(email, password) {
  const r = await call("POST", "/api/auth/login", { body: { email, password } });
  return { ...r, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
const health = await call("GET", "/api/health");
check("server memakai Supabase", health.data?.storage === "supabase", health.data?.storage);
if (health.data?.storage !== "supabase") process.exit(1);

const P = (await login("pusat@jaga.id", "JagaPusat2026!")), D = (await login("desa.leubokpusaka@jaga.id", "JagaDesa2026!"));
const R = (await login("rescue.bpbd@jaga.id", "JagaRescue2026!")), D2 = (await login("desa.seureuke@jaga.id", "JagaDesa2026!"));
const D3 = (await login("desa.buketlinteung@jaga.id", "JagaDesa2026!")), R3 = (await login("rescue.siagadesa@jaga.id", "JagaRescue2026!"));
check("login 7 akun seed lewat Supabase Auth", [P, D, R, D2, D3, R3].every(x => x.status === 200 && x.cookie), [P, D, R, D2, D3, R3].map(x => x.status).join(","));
check("sesi memuat peran dan wilayah benar", D.data?.session?.role === "DESA" && D.data?.session?.villageIds?.length === 1 && R.data?.session?.villageIds?.length === 3 && P.data?.session?.villageIds === null, JSON.stringify([D.data?.session?.villageIds?.length, R.data?.session?.villageIds?.length]));
check("login salah ditolak", (await login("pusat@jaga.id", "salahsalah")).status === 401);

const villages = (await call("GET", "/api/villages", { cookie: P.cookie })).data ?? [];
check("Pusat melihat 3 desa dengan provinsi", villages.length === 3 && villages.every(v => v.province === "Aceh"), villages.length);
const myVillage = (await call("GET", "/api/villages", { cookie: D.cookie })).data?.[0]?.id;
check("Desa hanya melihat desanya", ((await call("GET", "/api/villages", { cookie: D.cookie })).data ?? []).length === 1);
const resD2 = (await call("GET", "/api/residents?limit=1000", { cookie: D2.cookie })).data;
const listD2 = Array.isArray(resD2) ? resD2 : resD2?.data ?? [];
check("Desa Seureuke hanya melihat 3 warganya", listD2.length === 3 && listD2.every(r => r.villageId !== myVillage), listD2.length);
check("Desa lain ditolak membaca warga desa ini", (await call("GET", `/api/residents?villageId=${myVillage}`, { cookie: D2.cookie })).data?.data?.length === 0 || (await call("GET", `/api/residents?villageId=${myVillage}`, { cookie: D2.cookie })).status === 403);
check("Rescue tanpa operasi ditolak membuka daftar warga", (await call("GET", "/api/residents", { cookie: R.cookie })).status === 403);

// bersihkan sisa uji sebelumnya
for (const a of ((await call("GET", "/api/accounts", { cookie: P.cookie })).data ?? []).filter(a => a.email === "uji.supabase@jaga.id")) await call("DELETE", `/api/accounts/${a.id}`, { cookie: P.cookie });
const overview = (await call("GET", "/api/dashboard", { cookie: P.cookie })).data;
check("ringkasan Pusat memuat hitungan kendala, gudang, provinsi", typeof overview?.counters?.ticketsOpen === "number" && overview?.counters?.devicesWarehouse >= 3 && overview?.counters?.provinces === 1, JSON.stringify(overview?.counters ?? {}));

// kendala teknis
const tk = await call("POST", "/api/tickets", { cookie: D.cookie, body: { category: "KALUNG", priority: "SEDANG", title: "Uji e2e Supabase: kalung pengganti", description: "uji" } });
check("Desa membuat kendala teknis", tk.status === 201 && tk.data?.villageName, `${tk.status} ${tk.error ?? ""}`);
check("Pusat melihat kendala dan menyelesaikannya", (await call("GET", "/api/tickets", { cookie: P.cookie })).data?.some(t => t.id === tk.data?.id) && (await call("PATCH", `/api/tickets/${tk.data?.id}`, { cookie: P.cookie, body: { status: "RESOLVED", resolutionNote: "selesai uji" } })).data?.status === "RESOLVED");
check("Desa lain tidak melihat kendala itu", !((await call("GET", "/api/tickets", { cookie: D2.cookie })).data ?? []).some(t => t.id === tk.data?.id));

// inventaris kalung
const TEST_DEV = `JAGA-SB-${Date.now() % 100000}`;
const dev = await call("POST", "/api/devices", { cookie: P.cookie, body: { id: TEST_DEV, model: "JAGA Rumah v1" } });
check("Pusat mendaftarkan kalung ke gudang (tanpa desa dan koordinat)", dev.status === 201 && dev.data?.villageId === null && dev.data?.deviceKey, `${dev.status} ${dev.error ?? ""}`);
check("Desa tidak dapat mendaftarkan kalung", (await call("POST", "/api/devices", { cookie: D.cookie, body: { id: "JAGA-X", villageId: myVillage } })).status === 403);
const dist = await call("POST", `/api/devices/${TEST_DEV}/distribute`, { cookie: P.cookie, body: { villageId: myVillage } });
check("Pusat mendistribusikan kalung ke desa", dist.status === 200 && dist.data?.villageId === myVillage, `${dist.status} ${dist.error ?? ""}`);
check("kalung terlihat oleh Desa", ((await call("GET", "/api/devices", { cookie: D.cookie })).data?.data ?? []).some(d => d.id === TEST_DEV));
check("Pusat menarik kalung kembali ke gudang", (await call("POST", `/api/devices/${TEST_DEV}/distribute`, { cookie: P.cookie, body: {} })).data?.villageId === null);

// akun: buat, login, nonaktifkan, hapus
const mk = await call("POST", "/api/accounts", { cookie: P.cookie, body: { email: "uji.supabase@jaga.id", displayName: "Uji Supabase", role: "DESA", password: "KataSandi123!", organizationName: "Desa Uji Supabase", villageIds: [myVillage] } });
check("Pusat membuat akun lewat Supabase Auth", mk.status === 201, `${mk.status} ${mk.error ?? ""}`);
const own = await login("uji.supabase@jaga.id", "KataSandi123!");
check("akun baru dapat masuk dengan wilayah desa", own.status === 200 && own.data?.session?.villageIds?.[0] === myVillage, `${own.status} ${own.error ?? ""}`);
const acc = ((await call("GET", "/api/accounts", { cookie: P.cookie })).data ?? []).find(a => a.email === "uji.supabase@jaga.id");
check("daftar akun memuat id", !!acc?.id);
await call("PATCH", `/api/accounts/${acc?.id}`, { cookie: P.cookie, body: { active: false } });
check("akun nonaktif tidak dapat masuk", (await login("uji.supabase@jaga.id", "KataSandi123!")).status === 401);
check("sesi akun nonaktif langsung ditolak", (await call("GET", "/api/residents", { cookie: own.cookie })).status === 401);
const del = await call("DELETE", `/api/accounts/${acc?.id}`, { cookie: P.cookie });
check("Pusat menghapus akun (Auth + profil)", del.status === 200 && del.data?.deleted === true, `${del.status} ${del.error ?? ""} ${del.data?.mode ?? ""}`);
check("akun terhapus hilang dari daftar dan tidak bisa masuk", !((await call("GET", "/api/accounts", { cookie: P.cookie })).data ?? []).some(a => a.email === "uji.supabase@jaga.id") && (await login("uji.supabase@jaga.id", "KataSandi123!")).status === 401);
check("Pusat tidak dapat menghapus akunnya sendiri", (await call("DELETE", `/api/accounts/${P.data?.session?.profileId}`, { cookie: P.cookie })).status === 403);

// aturan prioritas
const sets = (await call("GET", "/api/rulesets", { cookie: P.cookie })).data ?? [];
const active = sets.find(s => s.status === "ACTIVE");
check("ada tepat satu aturan aktif", sets.filter(s => s.status === "ACTIVE").length === 1 && active?.ruleCount > 5, JSON.stringify(sets.map(s => [s.version, s.status, s.ruleCount])));
const rev = await call("POST", `/api/rulesets/${active?.id}/revise`, { cookie: P.cookie, body: {} });
check("revisi aturan menyalin aturan dan ambang (atau memakai draf yang ada)", [200, 201].includes(rev.status) && rev.data?.status === "DRAFT", `${rev.status} ${rev.error ?? ""}`);
const draft = (await call("GET", `/api/rulesets/${rev.data?.id}`, { cookie: P.cookie })).data;
check("draf memuat semua aturan", draft?.rules?.length === active?.ruleCount, `${draft?.rules?.length}/${active?.ruleCount}`);
const edited = draft.rules.map(r => r.factorKey === "lives_alone" ? { ...r, scoreDelta: 22 } : r);
const saved = await call("PUT", `/api/rulesets/${rev.data?.id}/rules`, { cookie: P.cookie, body: { rules: edited } });
check("bobot pada draf tersimpan", saved.status === 200 && saved.data?.find(r => r.factorKey === "lives_alone")?.scoreDelta === 22, `${saved.status} ${saved.error ?? ""}`);
check("ambang draf tersalin", ((await call("GET", `/api/thresholds?ruleSetId=${rev.data?.id}`, { cookie: P.cookie })).data ?? []).length >= 4);
check("draf dapat dibuang (arsip)", (await call("POST", `/api/rulesets/${rev.data?.id}/publish`, { cookie: P.cookie, body: { action: "archive" } })).data?.status === "ARCHIVED");

// alarm, operasi, SOS kalung, rute
check("alarm Waspada tidak membuka operasi", (await call("POST", "/api/alerts", { cookie: D.cookie, body: { villageId: myVillage, severity: "WASPADA", message: "Uji Supabase waspada" } })).data?.operation === null);
const siaga = await call("POST", "/api/alerts", { cookie: D.cookie, body: { villageId: myVillage, severity: "SIAGA", message: "Uji Supabase siaga", waterLevelCm: 70 } });
check("alarm Siaga membuka operasi (indeks unik, kolom area)", siaga.status === 201 && siaga.data?.operation?.id && siaga.data?.devicesReached >= 5, `${siaga.status} ${siaga.error ?? ""}`);
const op = siaga.data?.operation;
const roster = await call("GET", `/api/operations/${op?.id}/roster`, { cookie: R.cookie });
check("Rescue memperoleh roster pemakai kalung dengan prioritas berwarna", roster.status === 200 && roster.data?.length === 9 && roster.data.every(x => x.priority?.color), `${roster.status} ${roster.data?.length ?? ""} ${roster.error ?? ""}`);
const route = await call("GET", `/api/operations/${op?.id}/route?residentId=${roster.data?.[0]?.residentId}`, { cookie: R.cookie });
check("rute Rescue ke warga", route.status === 200 && route.data?.fastest?.distanceMeters > 0, `${route.status} ${route.error ?? ""}`);
check("Rescue desa (relawan) melihat roster desanya", (await call("GET", `/api/operations/${op?.id}/roster`, { cookie: R3.cookie })).status === 200);
const devs = ((await call("GET", "/api/devices?limit=100", { cookie: D.cookie })).data?.data ?? []).filter(d => d.residentId);
const free = devs.find(d => d.id === "JAGA-0001");
const hdr = { "X-JAGA-Device-Id": free.id, "X-JAGA-Device-Key": `jrk_${sha(`${free.id}:pusat@jaga.id`).slice(0, 32)}` };
const tel = await call("POST", "/api/device/telemetry", { headers: hdr, body: { battery: 61, latitude: 4.8485, longitude: 97.4731, gpsFix: true, accuracyMeters: 9, satellites: 8 } });
check("telemetri GPS dari kalung diterima dan disimpan", tel.status === 202 && tel.data?.locationAccepted === true, `${tel.status} ${tel.error ?? ""}`);
const sos = await call("POST", "/api/device/sos", { headers: hdr, body: { latitude: 4.8485, longitude: 97.4731, gpsFix: true, accuracyMeters: 9 } });
check("SOS kalung membuat insiden dan notifikasi", sos.status === 201 && sos.data?.incidentId, `${sos.status} ${sos.error ?? ""}`);
check("SOS ganda tidak menduplikasi insiden", (await call("POST", "/api/device/sos", { headers: hdr, body: {} })).data?.duplicate === true);
const inbox = await call("GET", "/api/device/inbox", { headers: hdr });
check("inbox kalung memuat perintah, activeSos, nextPollSeconds", inbox.status === 200 && inbox.data?.commands?.length >= 1 && inbox.data?.activeSos && inbox.data?.nextPollSeconds === 30, `${inbox.status} ${inbox.error ?? ""}`);
const cmd = inbox.data?.commands?.[0];
check("kalung mengonfirmasi alarm", (await call("POST", `/api/device/receipts/${cmd?.receiptId}`, { headers: hdr, body: { status: "ACKNOWLEDGED" } })).status === 200);
const notes = (await call("GET", "/api/notifications", { cookie: D.cookie })).data;
check("notifikasi SOS tersimpan untuk Desa", (Array.isArray(notes) ? notes : notes?.data ?? []).some(n => (n.templateCode ?? n.template_code) === "SOS" || n.title === "SOS"));
check("sinyal darurat tanpa konfirmasi ditolak", (await call("POST", "/api/alerts/emergency", { cookie: D.cookie, body: { villageId: myVillage } })).status === 400);
check("Pusat tidak dapat membunyikan alarm", (await call("POST", "/api/alerts", { cookie: P.cookie, body: { villageId: myVillage, severity: "SIAGA", message: "x" } })).status === 403);

// --- Status papan, gateway, pengumuman, platform, laporan, pengerahan tim
const gwCode = ((await call("GET", "/api/gateways", { cookie: P.cookie })).data ?? []).find(g => g.villageId === myVillage)?.gatewayCode;
const gwH = { "X-JAGA-Gateway-Key": `gtw_${sha(`${gwCode}:pusat@jaga.id`).slice(0, 32)}` };
const outbox = await call("GET", "/api/gateway/outbox", { headers: gwH });
check("outbox gateway memuat alarm Siaga dan kalung yang tombolnya terbuka", outbox.status === 200 && outbox.data?.commands?.length >= 1 && outbox.data?.unlockedDevices?.length >= 1, `${outbox.status} ${outbox.error ?? ""}`);
const ing = await call("POST", "/api/gateway/ingest", { headers: gwH, body: { events: [{ type: "telemetry", deviceId: "JAGA-0002", battery: 88, recordedAt: new Date(Date.now() - 5 * 60_000).toISOString() }, { type: "telemetry", deviceId: "JAGA-0101" }] } });
check("unggahan gateway store-and-forward: satu diterima, satu ditolak (desa lain)", ing.status === 200 && ing.data?.accepted === 1 && ing.data?.rejected === 1, JSON.stringify(ing.data?.results ?? ing.error).slice(0, 200));
const board = await call("GET", "/api/status-board", { cookie: D.cookie });
check("papan status: kalung yang menekan tombol = Meminta bantuan", board.status === 200 && board.data?.rows?.find(r => r.deviceId === free.id)?.state === "BANTUAN", JSON.stringify(board.data?.counts ?? board.error));
const ann = await call("POST", "/api/announcements", { cookie: P.cookie, body: { title: "Uji pengumuman Supabase", body: "Uji", priority: "PENTING", expiresInHours: 1 } });
check("Pusat mengirim pengumuman dan Rescue menerimanya", ann.status === 201 && ((await call("GET", "/api/announcements", { cookie: R.cookie })).data ?? []).some(a => a.id === ann.data?.id));
check("Pusat menghapus pengumuman", (await call("DELETE", `/api/announcements/${ann.data?.id}`, { cookie: P.cookie })).data?.deleted === true);
const plat = await call("PUT", "/api/platform", { cookie: P.cookie, body: { settings: { alert_expiry_minutes: 100, rescue_view_gps: true } } });
check("Pusat menyimpan pengaturan platform (upsert Supabase)", plat.status === 200 && plat.data?.settings?.alert_expiry_minutes === 100, `${plat.status} ${plat.error ?? ""}`);
await call("PUT", "/api/platform", { cookie: P.cookie, body: { settings: { alert_expiry_minutes: 120 } } });
const gov = await call("GET", "/api/governance", { cookie: P.cookie });
check("panel tata kelola memuat matriks dan persetujuan", gov.status === 200 && gov.data?.matrix?.length >= 6 && gov.data?.consent?.total >= 15, `${gov.status} ${gov.error ?? ""}`);
const vst = await call("GET", "/api/village-status", { cookie: P.cookie });
check("status desa: tiga desa dengan waktu sinkron", vst.status === 200 && vst.data?.villages?.length === 3 && vst.data.villages.every(v => v.lastSyncAt), `${vst.status} ${vst.error ?? ""}`);
const team = ((await call("GET", "/api/teams", { cookie: R.cookie })).data ?? []).find(t => /BPBD/.test(t.name));
check("Rescue melihat tim dari organisasi yang melayani desanya", ((await call("GET", "/api/teams", { cookie: R.cookie })).data ?? []).length >= 4 && ((await call("GET", "/api/teams", { cookie: D.cookie })).data ?? []).length >= 4);
await call("POST", `/api/teams/${team?.id}/position`, { cookie: R.cookie, body: { latitude: 4.8481, longitude: 97.4729 } });
await call("POST", `/api/teams/${team?.id}/position`, { cookie: R.cookie, body: { latitude: 4.8487, longitude: 97.4735 } });
const cov = await call("GET", `/api/operations/${op?.id}/coverage`, { cookie: R.cookie });
check("jejak tim muncul pada cakupan operasi", cov.status === 200 && cov.data?.teams?.find(t => t.teamId === team?.id)?.points?.length >= 2, `${cov.status} ${cov.error ?? ""}`);
const rep = await call("POST", `/api/operations/${op?.id}/reports`, { cookie: R.cookie, body: { summary: "Uji laporan pasca-operasi di Supabase dengan ringkasan yang cukup panjang.", foundCount: 2, evacuatedCount: 1, notFoundCount: 0, unreachableCount: 1, distanceKm: 3.5, teamId: team?.id } });
check("Rescue mengirim laporan pasca-operasi", rep.status === 201, `${rep.status} ${rep.error ?? ""}`);
check("Desa dan Pusat melihat laporan itu", ((await call("GET", "/api/operation-reports", { cookie: D.cookie })).data ?? []).some(r => r.id === rep.data?.id) && ((await call("GET", "/api/operation-reports", { cookie: P.cookie })).data ?? []).some(r => r.id === rep.data?.id));
const dispatch = await call("POST", `/api/incidents/${sos.data?.incidentId}/assignments`, { cookie: D.cookie, body: { teamId: ((await call("GET", "/api/teams", { cookie: D.cookie })).data ?? []).find(t => /Damkar/.test(t.name))?.id, note: "Uji pengerahan dari Desa", force: true } });
check("Desa mengerahkan tim Rescue", dispatch.status === 201, `${dispatch.status} ${dispatch.error ?? ""}`);
const nf = await call("PATCH", `/api/incidents/${sos.data?.incidentId}/status`, { cookie: R.cookie, body: { status: "NOT_FOUND" } });
check("status baru Tidak ditemukan diterima database (enum Supabase)", nf.status === 200, `${nf.status} ${nf.error ?? ""}`);
check("tombol kalung tetap terbuka selama warga belum dinyatakan aman", (await call("GET", "/api/device/inbox", { headers: hdr })).data?.buttonUnlocked === true);

const incId = sos.data?.incidentId;
await call("PATCH", `/api/incidents/${incId}/status`, { cookie: D.cookie, body: { status: "ACKNOWLEDGED" } });
check("Desa menutup insiden uji (SAFE)", (await call("PATCH", `/api/incidents/${incId}/status`, { cookie: D.cookie, body: { status: "SAFE" } })).status === 200);
check("Desa menutup operasi, akses Rescue berakhir", (await call("POST", `/api/operations/${op?.id}/close`, { cookie: D.cookie, body: {} })).data?.status === "CLOSED" && (await call("GET", `/api/operations/${op?.id}/roster`, { cookie: R.cookie })).status === 403);

// logout mencabut token Supabase
const lo = await login("desa.leubokpusaka@jaga.id", "JagaDesa2026!");
const tokenCookie = lo.cookie;
await call("POST", "/api/auth/logout", { cookie: tokenCookie });
check("token Supabase tidak berlaku setelah logout", (await call("GET", "/api/residents", { cookie: tokenCookie })).status === 401);

// tanpa RLS bocor: akses langsung REST Supabase tanpa kunci
const url = readFileSync(new URL("../../.env", import.meta.url), "utf8").match(/^SUPABASE_URL=(.+)$/m)?.[1]?.trim();
const anon = await fetch(`${url}/rest/v1/residents?select=full_name&limit=1`);
check("REST Supabase tanpa kunci menolak membaca data warga", anon.status === 401 || anon.status === 403, anon.status);

const failed = results.filter(r => !r.ok);
console.log("\n" + "=".repeat(60) + `\nHASIL SUPABASE: ${results.length - failed.length}/${results.length} lulus`);
for (const r of failed) console.log("  - " + r.name);
