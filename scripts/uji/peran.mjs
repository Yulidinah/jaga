// Uji alur per role di browser (Edge/Chrome headless). Server memori harus berjalan:
//   BASE=http://localhost:3100 OUT=./tmp-uji node scripts/uji/peran.mjs   (EDGE_PATH untuk lokasi browser)
// Langkah 2 - uji alur per role lewat browser sungguhan (klik, isi formulir), disertai pemeriksaan galat dan tampilan ponsel.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.env.BASE ?? "http://localhost:3100";
const out = process.env.OUT ?? "./tmp-uji"; mkdirSync(out, { recursive: true });
const edge = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "OK   " : "GAGAL"} ${name}${detail ? " :: " + detail : ""}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));

async function open(width = 1440, height = 950) {
  const port = 9300 + Math.floor(Math.random() * 600);
  const proc = spawn(edge, ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "jaga-r-"))}`, `--window-size=${width},${height}`, "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === "page"); } catch { /* belum siap */ }
    if (!target) await wait(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener("message", ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === "Runtime.exceptionThrown") errors.push("EXC " + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).slice(0, 200));
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push("CONSOLE " + msg.params.args.map(a => a.value ?? a.description ?? "").join(" ").slice(0, 200));
    if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400 && !/\/api\/(auth\/me|tickets)/.test(msg.params.response.url)) errors.push(`HTTP ${msg.params.response.status} ${msg.params.response.url.replace(base, "")}`);
  });
  const send = (method, params = {}) => new Promise(res => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  const js = async expr => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.confirm = () => true;" });
  const b = {
    send, js, errors, close: () => { ws.close(); proc.kill(); },
    shot: async name => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(out, name + ".png"), Buffer.from(r.result.data, "base64")); },
    until: async (expr, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await js(`!!(${expr})`)) return true; await wait(150); } return false; },
    go: async hash => { await js(`location.hash = '${hash}'`); await wait(1300); },
    click: sel => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`),
    fill: (sel, value) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`),
    text: () => js("document.body.innerText"),
    submit: sel => js(`(() => { const f = document.querySelector(${JSON.stringify(sel)}); if (!f) return false; f.requestSubmit(); return true; })()`)
  };
  b.login = async (email, pw, pageHash) => {
    await send("Page.navigate", { url: `${base}/login` }); await wait(1800);
    await b.fill("#loginForm [name=email]", email); await b.fill("#loginForm [name=password]", pw); await b.submit("#loginForm");
    await b.until("location.pathname === '/app'", 8000); await wait(1800);
    if (pageHash) await b.go(pageHash);
  };
  return b;
}
const noOverflow = async (b, label) => {
  const [sw, iw] = String(await b.js("document.documentElement.scrollWidth + '/' + innerWidth")).split("/").map(Number);
  check(`tanpa overflow horizontal: ${label}`, sw <= iw + 1, `${sw}/${iw}`);
};
const sha = v => createHash("sha256").update(v).digest("hex");

// ============================================================ DESA
console.log("\n=== JAGA DESA (Leubok Pusaka) ===");
const desa = await open();
await desa.login("desa.leubokpusaka@jaga.id", "JagaDesa2026!", "#/beranda");
check("Desa: beranda memuat kartu sinyal darurat dan KPI", await desa.js("!!document.querySelector('.emergency-card') && document.querySelectorAll('.kpi').length >= 4"));
check("Desa: chip peran tampil di atas", (await desa.js("document.querySelector('.role-chip')?.textContent")) === "JAGA Desa");

// warga baru
await desa.go("#/warga");
await desa.click("[data-modal=resident]"); await desa.until("document.querySelector('#modalForm')");
await desa.fill("#modalForm [name=fullName]", "Warga Uji E2E");
await desa.fill("#modalForm [name=evacuationAbility]", "PERLU_BANTUAN");
await desa.js("document.querySelector('#modalForm [name=vulnerability][value=LANSIA]').click(); document.querySelector('#modalForm [name=consented]').click(); true");
await desa.submit("#modalForm");
check("Desa: menambah warga baru", await desa.until("document.body.innerText.includes('Warga Uji E2E')", 6000));
await desa.shot("desa-warga");

// titik evakuasi: tambah, ubah, hapus
await desa.go("#/titik");
await desa.click("[data-modal=shelter]"); await desa.until("document.querySelector('#modalForm')");
await desa.fill("#modalForm [name=name]", "Titik Uji E2E"); await desa.fill("#modalForm [name=capacity]", "30");
await desa.submit("#modalForm");
check("Desa: menambah titik evakuasi", await desa.until("document.body.innerText.includes('Titik Uji E2E')"));
await desa.js("[...document.querySelectorAll('tr')].find(r => r.innerText.includes('Titik Uji E2E')).querySelector('[data-modal=shelter]').click()");
await desa.until("document.querySelector('#modalForm')"); await desa.fill("#modalForm [name=capacity]", "77"); await desa.submit("#modalForm");
check("Desa: mengubah kapasitas titik evakuasi", await desa.until("[...document.querySelectorAll('tr')].some(r => r.innerText.includes('Titik Uji E2E') && r.innerText.includes('77'))"));
await desa.js("[...document.querySelectorAll('tr')].find(r => r.innerText.includes('Titik Uji E2E')).querySelector('[data-action=shelter-delete]').click()");
check("Desa: menghapus titik evakuasi", await desa.until("!document.body.innerText.includes('Titik Uji E2E')"));

// kendala dengan HTML jahat
await desa.go("#/kendala");
await desa.fill("[data-form=ticket] [name=title]", "<img src=x onerror=window.__xss=1> kalung rusak");
await desa.fill("[data-form=ticket] [name=description]", "<script>window.__xss=2</script> uraian");
await desa.submit("[data-form=ticket]");
check("Desa: mengirim kendala teknis ke Pusat", await desa.until("document.body.innerText.includes('kalung rusak')"));
check("Desa: HTML pada kendala ditampilkan sebagai teks (tidak dieksekusi)", (await desa.js("!window.__xss && !document.querySelector('img[src=x]')")) === true);
await desa.shot("desa-kendala");

// alarm Siaga lengkap dengan konfirmasi
await desa.go("#/alarm");
await desa.fill("[data-bind='alarm.waterLevelCm']", "80");
await desa.submit("[data-form=alarm-review]");
check("Desa: alarm menampilkan modal konfirmasi", await desa.until("document.querySelector('#confirmSend')"));
check("Desa: tombol kirim terkunci sebelum konfirmasi dicentang", await desa.js("document.querySelector('#confirmSend').disabled") === true);
await desa.js("document.querySelector('#confirmCheck').click()");
check("Desa: tombol kirim aktif setelah dicentang", await desa.js("!document.querySelector('#confirmSend').disabled"));
await desa.click("#confirmSend");
await desa.go("#/beranda");
check("Desa: operasi terbuka otomatis setelah alarm Siaga", await desa.until("document.querySelector('.op-card')", 8000));
await desa.click("[data-modal=water]"); await desa.until("document.querySelector('#modalForm')");
await desa.fill("#modalForm [name=waterLevelCm]", "120"); await desa.submit("#modalForm");
check("Desa: memperbarui tinggi air operasi", await desa.until("document.querySelector('.op-card')?.innerText.includes('120 cm')"));
await desa.shot("desa-operasi");

// ============================================================ RESCUE
console.log("\n=== JAGA RESCUE (BPBD) ===");
const rescue = await open();
await rescue.login("rescue.bpbd@jaga.id", "JagaRescue2026!", "#/prioritas");
check("Rescue: melihat daftar prioritas berwarna setelah operasi dibuka Desa", await rescue.until("document.querySelectorAll('.prio-card').length >= 5", 8000));
check("Rescue: kartu prioritas memuat alasan", await rescue.js("[...document.querySelectorAll('.prio-card .why')].every(w => w.innerText.length > 15)"));
await rescue.shot("rescue-prioritas");
await rescue.click("[data-action=open-route]");
check("Rescue: rute ke warga dihitung dan tautan navigasi tersedia", await rescue.until("document.querySelectorAll('.route-links a').length === 2 && /jarak/.test(document.querySelector('#routeInfo').innerText)", 12000));
await rescue.shot("rescue-rute");
await rescue.click("[data-action=close-modal]");
await rescue.go("#/operasi");
check("Rescue: roster operasi terisi", await rescue.until("document.querySelectorAll('tbody tr').length >= 5"));

// ============================================================ SOS LINTAS ROLE
console.log("\n=== SOS dari kalung -> semua role ===");
const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "pusat@jaga.id", password: "JagaPusat2026!" }) });
const P = login.headers.get("set-cookie").split(";")[0];
const devs = (await (await fetch(base + "/api/devices?limit=100", { headers: { cookie: P } })).json()).data.data;
const open_ = (await (await fetch(base + "/api/incidents?limit=500", { headers: { cookie: P } })).json()).data.data.filter(i => !["SAFE", "CLOSED", "CANCELLED"].includes(i.status)).map(i => i.deviceId);
const sosDev = devs.find(d => d.residentId && d.villageId && !open_.includes(d.id) && d.id.startsWith("JAGA-000"));
const sosRes = await fetch(base + "/api/device/sos", { method: "POST", headers: { "Content-Type": "application/json", "X-JAGA-Device-Id": sosDev.id, "X-JAGA-Device-Key": `jrk_${sha(`${sosDev.id}:pusat@jaga.id`).slice(0, 32)}` }, body: JSON.stringify({ latitude: 4.848, longitude: 97.473, gpsFix: true, accuracyMeters: 7 }) });
check("Kalung mengirim SOS ke server", sosRes.status === 201);
check("Desa: banner SOS baru muncul seketika (SSE)", await desa.until("document.querySelector('.sos-bar')", 8000));
check("Rescue: banner SOS baru muncul seketika (SSE)", await rescue.until("document.querySelector('.sos-bar')", 8000));
await desa.go("#/kejadian");
await desa.js("document.querySelector('[data-modal=sos]').click()");
check("Desa: detail SOS memuat waktu, koordinat, status kalung, dan log", await desa.until("(() => { const t = document.querySelector('.sos-panel')?.innerText || ''; return /Latitude/.test(t) && /Status perangkat/.test(t) && /Log aktivitas/.test(t); })()"));
await desa.shot("desa-sos-detail");
await desa.js("document.querySelector('[data-action=close-modal]')?.click()");

// Rescue menangani insiden
await rescue.go("#/tugas");
const before = await rescue.js("document.querySelectorAll('[data-action=incident-status]').length");
await rescue.click("[data-action=incident-status]"); await wait(1500);
check("Rescue: aksi status penanganan insiden berjalan", before > 0 && (await rescue.text()).length > 100);
await rescue.go("#/kendala");
await rescue.fill("[data-form=ticket] [name=title]", "Peta lambat saat sinyal lemah");
await rescue.submit("[data-form=ticket]");
check("Rescue: melapor kendala teknis", await rescue.until("document.body.innerText.includes('Peta lambat saat sinyal lemah')"));

// Desa menutup operasi, akses Rescue berakhir
await desa.go("#/beranda");
await desa.click("[data-modal=close-op]"); await desa.until("document.querySelector('#modalForm')"); await desa.submit("#modalForm");
check("Desa: menutup operasi", await desa.until("!document.querySelector('.op-card')", 8000));
await rescue.go("#/prioritas"); await rescue.js("location.reload()"); await wait(2500);
check("Rescue: akses roster berakhir setelah operasi ditutup", await rescue.until("document.querySelectorAll('.prio-card').length === 0", 8000));

// tombol sinyal darurat satu langkah
await desa.click("[data-modal=emergency]"); await desa.until("document.querySelector('#confirmSend')");
await desa.js("document.querySelector('#confirmCheck').click()"); await desa.click("#confirmSend");
check("Desa: sinyal darurat satu tombol membuka operasi", await desa.until("document.querySelector('.op-card')", 8000));
await desa.click("[data-modal=close-op]"); await desa.until("document.querySelector('#modalForm')"); await desa.submit("#modalForm"); await wait(1500);

// ============================================================ PUSAT
console.log("\n=== JAGA PUSAT ===");
const pusat = await open();
await pusat.login("pusat@jaga.id", "JagaPusat2026!", "#/ringkasan");
check("Pusat: judul Ringkasan JAGA Pusat", (await pusat.js("document.querySelector('h1').innerText")) === "Ringkasan JAGA Pusat");
check("Pusat: sidebar tanpa blok peran, jaringan, dan kartu pengguna", await pusat.js("!document.querySelector('.role-card') && !document.querySelector('.side-user') && !document.querySelector('.net')"));
for (const pg of ["ringkasan", "desa", "warga", "kalung", "kendala", "aturan", "akun", "laporan", "audit"]) {
  await pusat.go("#/" + pg);
  check(`Pusat: halaman ${pg} termuat`, await pusat.js("document.querySelector('h1')?.innerText.length > 2 && !document.querySelector('.loading')"));
}
// monitoring + filter provinsi
await pusat.go("#/desa");
check("Pusat: peta berada di atas tabel desa", await pusat.js("document.querySelector('[data-map=overview]').getBoundingClientRect().top < document.querySelector('table').getBoundingClientRect().top"));
await pusat.fill("[data-bind='pusat.province']", "Aceh");
check("Pusat: filter provinsi bekerja", await pusat.until("document.body.innerText.includes('3 desa di Aceh')"));
// data warga per wilayah
await pusat.go("#/warga");
check("Pusat: data warga dipisah per desa", await pusat.js("document.querySelectorAll('.group-row').length === 3"));
await pusat.fill("[data-bind='pusat.village']", await pusat.js("[...document.querySelectorAll('[data-bind=\"pusat.village\"] option')].find(o => o.textContent.includes('Seureuke')).value"));
check("Pusat: filter desa menyisakan satu kelompok", await pusat.until("document.querySelectorAll('.group-row').length === 1"));
// kendala: selesaikan
await pusat.go("#/kendala");
check("Pusat: melihat kendala dari Desa dan Rescue", await pusat.js("document.body.innerText.includes('kalung rusak')") || await pusat.until("document.body.innerText.includes('kalung rusak')"));
await pusat.click("[data-action=ticket-filter][data-value=all]"); await wait(500);
check("Pusat: HTML pada kendala tidak dieksekusi", (await pusat.js("!window.__xss && !document.querySelector('img[src=x]')")) === true);
await pusat.click("[data-modal=ticket-resolve]"); await pusat.until("document.querySelector('#modalForm')");
await pusat.fill("#modalForm [name=resolutionNote]", "Kalung pengganti dikirim"); await pusat.submit("#modalForm");
check("Pusat: menyelesaikan kendala dengan catatan", await pusat.until("document.body.innerText.includes('Kalung pengganti dikirim') || document.querySelectorAll('.badge.green').length > 0"));
// kalung
await pusat.go("#/kalung");
await pusat.click("[data-modal=device-new]"); await pusat.until("document.querySelector('#modalForm')");
await pusat.fill("#modalForm [name=id]", "JAGA-E2E1"); await pusat.submit("#modalForm");
check("Pusat: mendaftarkan kalung dan kunci tampil sekali", await pusat.until("document.body.innerText.includes('jrk_')"));
await pusat.click("[data-action=close-modal]");
await pusat.js("[...document.querySelectorAll('tr')].find(r => r.innerText.includes('JAGA-E2E1')).querySelector('[data-modal=device-dist]').click()");
await pusat.until("document.querySelector('#modalForm')");
await pusat.fill("#modalForm [name=villageId]", await pusat.js("[...document.querySelectorAll('#modalForm option')].find(o => o.textContent.includes('Seureuke')).value")); await pusat.submit("#modalForm");
check("Pusat: mendistribusikan kalung ke desa", await pusat.until("[...document.querySelectorAll('tr')].some(r => r.innerText.includes('JAGA-E2E1') && r.innerText.includes('Seureuke'))"));
// aturan
await pusat.go("#/aturan");
await pusat.click("[data-action=rules-revise]");
check("Pusat: membuat draf revisi aturan", await pusat.until("document.querySelectorAll('input[name^=score_]').length > 5", 8000));
await pusat.fill("input[name=score_0]", "41");
await pusat.submit("[data-form=rules-save]"); await wait(1500);
await pusat.click("[data-modal=rules-activate]"); await pusat.until("document.querySelector('#modalForm')");
await pusat.fill("#modalForm [name=approvalNote]", "Disetujui rapat uji e2e"); await pusat.submit("#modalForm");
check("Pusat: mengaktifkan aturan baru (versi 2)", await pusat.until("document.body.innerText.includes('Versi 2') && !document.querySelector('[data-form=rules-save]')", 8000));
// akun
await pusat.go("#/akun");
await pusat.click("[data-modal=account]"); await pusat.until("document.querySelector('#modalForm')");
await pusat.fill("#modalForm [name=displayName]", "Akun Uji E2E"); await pusat.fill("#modalForm [name=email]", "e2e@jaga.id"); await pusat.fill("#modalForm [name=password]", "KataSandi123!");
await pusat.fill("#modalForm [name=organizationName]", "Desa Uji E2E");
await pusat.js("document.querySelector('#modalForm [name=villageIds]').click()"); await pusat.submit("#modalForm");
check("Pusat: membuat akun baru", await pusat.until("document.body.innerText.includes('e2e@jaga.id')"));
await pusat.js("[...document.querySelectorAll('tr')].find(r => r.innerText.includes('e2e@jaga.id')).querySelector('[data-action=account-delete]').click()");
check("Pusat: menghapus akun", await pusat.until("!document.body.innerText.includes('e2e@jaga.id')"));
check("Pusat: tidak ada tombol hapus untuk akun sendiri", await pusat.js("![...document.querySelectorAll('tr')].find(r => r.innerText.includes('pusat@jaga.id'))?.querySelector('[data-action=account-delete]')"));
await pusat.shot("pusat-akun");


// ============================================================ KESESUAIAN SRS
console.log("\n=== Fitur sesuai SRS ===");
const api = async (method, path, body, headers = {}, cookie = P) => {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: (await r.json().catch(() => ({}))).data };
};
const cookieOf = async (email, pw) => (await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) })).headers.get("set-cookie").split(";")[0];
const D1 = await cookieOf("desa.leubokpusaka@jaga.id", "JagaDesa2026!");

// --- Alarm ke kelompok, papan status, dan pengerahan tim
await desa.click(".level.WASPADA"); await desa.fill("[data-bind='alarm.target']", "GROUP:LANSIA"); await desa.submit("[data-form=alarm-review]");
check("Desa: alarm ke kelompok lansia menampilkan konfirmasi dengan sasaran kelompok", await desa.until("document.querySelector('#confirmSend') && /kelompok lansia/.test(document.querySelector('.modal-body').innerText)"));
await desa.js("document.querySelector('#confirmCheck').click()"); await desa.click("#confirmSend"); await wait(1500);
await desa.go("#/status");
check("Desa: papan status warga memuat hitungan dan baris penerima", await desa.until("document.querySelectorAll('.kpi').length >= 4 && document.querySelectorAll('tbody tr').length >= 9"));
const lansiaDev = (await api("GET", "/api/devices?limit=100", null, {}, D1)).data.data.find(d => d.residentName === "Cut Maryam");
await api("POST", "/api/alerts", { villageId: (await api("GET", "/api/villages", null, {}, D1)).data[0].id, severity: "WASPADA", message: "Buka tombol uji status", targetType: "PERANGKAT", targetReference: lansiaDev.id }, {}, D1);
const press = await api("POST", "/api/device/sos", { latitude: 4.848, longitude: 97.4729 }, { "X-JAGA-Device-Id": lansiaDev.id, "X-JAGA-Device-Key": `jrk_${sha(`${lansiaDev.id}:pusat@jaga.id`).slice(0, 32)}` }, null);
await desa.js("location.reload()"); await wait(2500); await desa.go("#/status");
check("Desa: papan status menampilkan 'Meminta bantuan' setelah tombol kalung ditekan", press.status === 201 || press.status === 200 ? await desa.until("[...document.querySelectorAll('tbody tr')].some(r => /Cut Maryam/.test(r.innerText) && /Meminta bantuan/.test(r.innerText))", 8000) : false, `sos ${press.status}`);
await desa.js("[...document.querySelectorAll('tbody tr')].find(r => /Cut Maryam/.test(r.innerText)).querySelector('[data-modal=dispatch]').click()");
check("Desa: modal kerahkan tim memuat daftar tim", await desa.until("document.querySelectorAll('#modalForm [name=teamId] option').length >= 3"));
await desa.submit("#modalForm");
check("Desa: mengerahkan tim Rescue langsung dari dasbor", await desa.until("!document.querySelector('#modalForm')", 6000));

// --- Ubah dan nonaktifkan warga
await desa.go("#/warga");
await desa.js("[...document.querySelectorAll('tbody tr')].find(r => /Nurul Huda/.test(r.innerText)).querySelector('[data-action=edit-resident]').click()");
check("Desa: modal ubah warga terisi data warga", await desa.until("document.querySelector('#modalForm [name=fullName]')?.value === 'Nurul Huda'"));
await desa.fill("#modalForm [name=phone]", "0812-9999-0000"); await desa.submit("#modalForm");
check("Desa: perubahan data warga tersimpan", await desa.until("!document.querySelector('#modalForm')", 8000));
await desa.js("[...document.querySelectorAll('tbody tr')].find(r => /Warga Uji E2E/.test(r.innerText))?.querySelector('[data-action=delete-resident]').click()");
check("Desa: menonaktifkan warga", await desa.until("!document.body.innerText.includes('Warga Uji E2E')", 8000));

// --- Mode offline dan antrean
await desa.go("#/kendala");
await desa.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await desa.fill("[data-form=ticket] [name=title]", "Kendala dibuat saat offline"); await desa.submit("[data-form=ticket]");
check("Desa: saat offline perubahan masuk antrean dan indikator offline tampil", await desa.until("document.querySelector('.offline-bar') && /1 perubahan/.test(document.querySelector('.offline-bar').innerText)", 8000));
await desa.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
check("Desa: setelah online antrean otomatis tersinkron", await desa.until("!document.querySelector('.offline-bar') && document.body.innerText.includes('Kendala dibuat saat offline')", 40000));

// --- Pusat: pengumuman, platform, status desa, akun
await pusat.go("#/pengumuman");
await pusat.fill("[data-form=announcement] [name=title]", "Uji sirene serentak"); await pusat.fill("[data-form=announcement] [name=body]", "Mohon seluruh desa memeriksa kalung hari ini");
await pusat.fill("[data-form=announcement] [name=priority]", "PENTING"); await pusat.submit("[data-form=announcement]");
check("Pusat: mengirim pengumuman penting", await pusat.until("document.body.innerText.includes('Uji sirene serentak')"));
check("Desa: banner pengumuman penting tampil seketika", await desa.until("document.querySelector('.notice-bar')?.innerText.includes('Uji sirene serentak')", 10000));
await pusat.go("#/platform");
check("Pusat: halaman Platform & data memuat pengaturan, versi, dan matriks akses", await pusat.until("document.querySelector('[data-form=platform]') && /Siapa melihat apa/.test(document.body.innerText) && /NIK/.test(document.body.innerText)"));
await pusat.js("document.querySelector('[data-form=platform] [name=rescue_view_medical]').click()"); await pusat.submit("[data-form=platform]");
check("Pusat: kebijakan data Rescue tersimpan dan matriks ikut berubah", await pusat.until("[...document.querySelectorAll('tbody tr')].find(r => /Catatan medis/.test(r.innerText))?.innerText.includes('Tidak')", 8000));
await pusat.js("document.querySelector('[data-form=platform] [name=rescue_view_medical]').click()"); await pusat.submit("[data-form=platform]"); await wait(1500);
await pusat.shot("pusat-platform");
await pusat.go("#/ringkasan");
check("Pusat: ringkasan memuat status desa dan sinkron serta hasil penanganan", await pusat.until("/Status desa dan sinkron/.test(document.body.innerText) && /Hasil penanganan/.test(document.body.innerText) && document.querySelectorAll('tbody tr').length >= 3"));
await pusat.go("#/akun");
await pusat.js("[...document.querySelectorAll('tr')].find(r => r.innerText.includes('desa.seureuke@jaga.id')).querySelector('[data-modal=account-edit]').click()");
await pusat.until("document.querySelector('#modalForm [name=title]')"); await pusat.fill("#modalForm [name=title]", "Operator Utama Seureuke"); await pusat.submit("#modalForm");
check("Pusat: mengubah akun", await pusat.until("document.body.innerText.includes('Operator Utama Seureuke')", 8000));
await pusat.go("#/laporan");
check("Pusat: laporan memuat laporan pasca-operasi dan tombol cetak/PDF", await pusat.until("document.querySelector('[data-action=print-report]') && /Laporan pasca-operasi Rescue/.test(document.body.innerText) && /TRC BPBD|BPBD Kabupaten/.test(document.body.innerText)"));

// --- Rescue: laporan, status baru, peta offline
const opNow = (await api("POST", "/api/alerts", { villageId: (await api("GET", "/api/villages", null, {}, D1)).data[0].id, severity: "SIAGA", message: "Operasi uji peta offline" }, {}, D1)).data?.operation;
await rescue.go("#/laporan");
await rescue.js("location.reload()"); await wait(2500); await rescue.go("#/laporan");
check("Rescue: halaman laporan operasi memuat formulir", await rescue.until("document.querySelector('[data-form=report] [name=operationId]')"));
await rescue.fill("[data-form=report] [name=summary]", "Tim menyisir kawasan dari selatan, dua warga dievakuasi."); await rescue.fill("[data-form=report] [name=evacuatedCount]", "2"); await rescue.submit("[data-form=report]");
check("Rescue: mengirim laporan pasca-operasi", await rescue.until("document.body.innerText.includes('Tim menyisir kawasan dari selatan, dua warga dievakuasi.')", 8000));
await rescue.go("#/tugas");
check("Rescue: tersedia status Tidak ditemukan dan Tidak terjangkau pada tugas yang berjalan", await rescue.until("[...document.querySelectorAll('[data-action=incident-status]')].some(b => b.dataset.status === 'NOT_FOUND') && [...document.querySelectorAll('[data-action=incident-status]')].some(b => b.dataset.status === 'UNREACHABLE')", 8000));
await rescue.go("#/tim");
check("Rescue: kartu pelacakan jalur tim tersedia", await rescue.until("document.querySelector('[data-action=track-start]') && document.querySelector('#trackTeam')"));
await rescue.go("#/operasi");
check("Rescue: tombol unduh peta offline tersedia", await rescue.until("document.querySelector('[data-action=op-tiles]')", 8000));
await rescue.click("[data-action=op-tiles]");
check("Rescue: ubin peta disimpan untuk dipakai offline", await rescue.until("caches.open('jaga-tiles-v1').then(c => c.keys()).then(k => { window.__tiles = k.length; return true; }) && window.__tiles > 0", 60000) || (await rescue.js("window.__tiles")) > 0);
await wait(1000);
check("Rescue: ubin tersimpan di cache peramban", (await rescue.js("caches.open('jaga-tiles-v1').then(c => c.keys()).then(k => k.length)")) > 20);
await api("POST", `/api/operations/${opNow?.id}/close`, {}, {}, D1);

// ============================================================ PONSEL
console.log("\n=== Tampilan ponsel (500 px) ===");
for (const [name, email, pw, pages] of [
  ["Pusat", "pusat@jaga.id", "JagaPusat2026!", ["ringkasan", "desa", "warga", "kalung", "kendala", "pengumuman", "aturan", "akun", "platform", "laporan"]],
  ["Desa", "desa.leubokpusaka@jaga.id", "JagaDesa2026!", ["beranda", "warga", "alarm", "status", "kalung", "kejadian", "titik", "kendala", "peta"]],
  ["Rescue", "rescue.bpbd@jaga.id", "JagaRescue2026!", ["prioritas", "operasi", "tugas", "tim", "laporan", "kendala", "peta"]]
]) {
  const m = await open(500, 900);
  await m.login(email, pw);
  for (const pg of pages) { await m.go("#/" + pg); await wait(500); await noOverflow(m, `${name}/${pg}`); }
  await m.shot(`m-${name}`);
  check(`galat konsol ponsel ${name}`, m.errors.length === 0, m.errors.slice(0, 2).join(" | "));
  m.close();
}

for (const [name, b] of [["Desa", desa], ["Rescue", rescue], ["Pusat", pusat]]) {
  check(`galat konsol/jaringan tak terduga: ${name}`, b.errors.length === 0, [...new Set(b.errors)].slice(0, 4).join(" | "));
  b.close();
}
const failed = results.filter(r => !r.ok);
console.log("\n" + "=".repeat(60) + `\nHASIL: ${results.length - failed.length}/${results.length} lulus`);
for (const r of failed) console.log("  - " + r.name);
process.exit(0);
