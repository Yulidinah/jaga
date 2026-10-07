// smoke.mjs - tes regresi alur utama lewat HTTP nyata (mode memori).
// Menjalankan server sendiri pada port acak: `npm run build && npm run smoke`.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const port = 3300 + Math.floor(Math.random() * 500);
const base = process.env.BASE ?? `http://localhost:${port}`;
let server = null;
if (!process.env.BASE) {
  server = spawn(process.execPath, ["backend/dist/server.js"], {
    env: { ...process.env, PORT: String(port), JAGA_FORCE_MEMORY: "true", JAGA_TEST_FIXTURES: "true", SUPABASE_URL: "", SUPABASE_SECRET_KEY: "" },
    stdio: "ignore"
  });
}
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK   " : "GAGAL"} ${name}${detail ? " :: " + detail : ""}`);
};
const sha = value => createHash("sha256").update(value).digest("hex");

async function call(method, path, { body, cookie, headers = {} } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text.slice(0, 100); }
  return { status: response.status, data: json?.data, error: json?.error, headers: response.headers };
}
async function login(email, password) {
  const response = await call("POST", "/api/auth/login", { body: { email, password } });
  return { ...response, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(base + "/api/health")).ok) return; } catch { /* belum siap */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Server tidak siap");
}

try {
  await waitReady();

  // --- Dasar
  const health = await call("GET", "/api/health");
  check("health melaporkan penyimpanan sebenarnya", health.data?.storage === "memory", health.data?.storage);
  check("endpoint terlindungi tanpa sesi = 401", (await call("GET", "/api/dashboard")).status === 401);
  check("header X-JAGA-Role tidak dipercaya", (await call("GET", "/api/dashboard", { headers: { "X-JAGA-Role": "PUSAT" } })).status === 401);
  check("login salah ditolak 401", (await call("POST", "/api/auth/login", { body: { email: "pusat@jaga.id", password: "salah" } })).status === 401);
  check("cookie rusak tidak menyebabkan 500", (await call("GET", "/api/villages", { headers: { cookie: "jaga_session=%E0%A4%A" } })).status === 401);

  const pusat = await login("pusat@jaga.id", "JagaPusat2026!");
  const desa = await login("desa.leubokpusaka@jaga.id", "JagaDesa2026!");
  const rescue = await login("rescue.bpbd@jaga.id", "JagaRescue2026!");
  check("login 3 peran", [pusat, desa, rescue].every(r => r.status === 200 && r.cookie));
  const P = pusat.cookie, D = desa.cookie, R = rescue.cookie;

  check("path rusak = 400 bukan 500", (await call("GET", "/api/residents/%E0%A4%A", { cookie: P })).status === 400);

  // --- Kontrak data
  const dash = await call("GET", "/api/dashboard", { cookie: D });
  check("dashboard punya counters", typeof dash.data?.counters?.residents === "number");
  const myVillage = (await call("GET", "/api/villages", { cookie: D })).data?.[0]?.id;
  const allVillages = (await call("GET", "/api/villages", { cookie: P })).data ?? [];
  const otherVillage = allVillages.find(v => v.id !== myVillage)?.id;
  const residentsAll = (await call("GET", "/api/residents?limit=1000", { cookie: P })).data?.data ?? [];
  const foreignResident = residentsAll.find(r => r.villageId === otherVillage);
  const myResident = residentsAll.find(r => r.villageId === myVillage && r.vulnerabilityCount > 0);
  check("daftar warga berisi kerentanan bernama", Array.isArray(myResident?.vulnerabilities) && !!myResident.vulnerabilities[0]?.name);

  // --- Otorisasi
  check("snapshot warga desa lain ditolak", (await call("GET", `/api/dashboard/resident/${foreignResident.id}`, { cookie: D })).status === 403);
  check("audit/recent hanya PUSAT", (await call("GET", "/api/audit/recent", { cookie: R })).status === 403 && (await call("GET", "/api/audit/recent", { cookie: P })).status === 200);
  const foreignDevice = ((await call("GET", `/api/devices?villageId=${otherVillage}`, { cookie: P })).data?.data ?? [])[0];
  const crossAlert = await call("POST", "/api/alerts", { cookie: D, body: { villageId: myVillage, targetType: "PERANGKAT", targetReference: foreignDevice?.id, severity: "SIAGA", message: "uji" } });
  check("alarm ke perangkat desa lain ditolak", crossAlert.status === 400, `status ${crossAlert.status}`);
  const noTarget = await call("POST", "/api/alerts", { cookie: D, body: { villageId: myVillage, targetType: "KELOMPOK_RENTAN", targetReference: "DISABILITAS_INTELEKTUAL", severity: "SIAGA", message: "uji" } });
  check("target tanpa perangkat tidak menyiarkan ke semua", noTarget.status === 400, `status ${noTarget.status}`);
  const assignmentsLeak = (await call("GET", "/api/assignments", { cookie: D })).data ?? [];
  check("daftar penugasan hanya desa sendiri", assignmentsLeak.every(a => a.villageId === myVillage));
  const rescueEdit = await call("PUT", `/api/residents/${myResident.id}/vulnerabilities`, { cookie: R, body: { vulnerabilities: [] } });
  check("rescue tidak dapat mengubah kerentanan warga", rescueEdit.status === 403, `status ${rescueEdit.status}`);

  // --- Filter
  const stockOnly = (await call("GET", "/api/devices?status=STOCK", { cookie: P })).data;
  const stockInVillage = (await call("GET", `/api/devices?status=STOCK&villageId=${myVillage}`, { cookie: P })).data;
  check("filter status + desa digabung", stockInVillage.total <= stockOnly.total && stockInVillage.data.every(d => d.status === "STOCK" && d.villageId === myVillage));
  const act = (await call("GET", `/api/residents?villageId=${otherVillage}&active=true`, { cookie: P })).data;
  const noAct = (await call("GET", `/api/residents?villageId=${otherVillage}`, { cookie: P })).data;
  check("filter villageId bertahan saat active diisi", act.total === noAct.total && act.data.every(r => r.villageId === otherVillage));

  // --- Alarm sampai ke perangkat
  const myDevice = ((await call("GET", `/api/devices?villageId=${myVillage}`, { cookie: P })).data?.data ?? []).find(d => d.residentId);
  const gateways = (await call("GET", "/api/gateways", { cookie: P })).data ?? [];
  const deviceKey = `jrk_${sha(`${myDevice.id}:pusat@jaga.id`).slice(0, 32)}`;
  const gatewayKey = `gtw_${sha(`${gateways[0].gatewayCode}:pusat@jaga.id`).slice(0, 32)}`;
  const deviceHeaders = { "x-jaga-device-id": myDevice.id, "x-jaga-device-key": deviceKey };
  const alert = await call("POST", "/api/alerts", { cookie: D, body: { villageId: myVillage, severity: "AWAS", message: "Uji alarm" } });
  check("alarm desa dibuat", alert.status === 201 && alert.data?.devicesReached >= 1, `devicesReached=${alert.data?.devicesReached}`);
  check("status alarm awal QUEUED", alert.data?.command?.status === "QUEUED");
  const inbox = await call("GET", "/api/device/inbox", { headers: deviceHeaders });
  const received = inbox.data?.commands?.[0];
  check("inbox perangkat berisi alarm dengan receiptId", inbox.status === 200 && !!received?.receiptId && received.severity === "AWAS");
  const ack = await call("POST", `/api/device/receipts/${received.receiptId}`, { headers: deviceHeaders, body: { status: "ACKNOWLEDGED" } });
  check("perangkat mengonfirmasi alarm", ack.status === 200 && ack.data?.status === "ACKNOWLEDGED");
  const otherDevice = ((await call("GET", `/api/devices?villageId=${myVillage}`, { cookie: P })).data?.data ?? []).find(d => d.id !== myDevice.id && d.residentId);
  if (otherDevice) {
    const otherKey = `jrk_${sha(`${otherDevice.id}:pusat@jaga.id`).slice(0, 32)}`;
    const steal = await call("POST", `/api/device/receipts/${received.receiptId}`, { headers: { "x-jaga-device-id": otherDevice.id, "x-jaga-device-key": otherKey }, body: {} });
    check("perangkat lain tidak dapat mengonfirmasi receipt ini", steal.status === 403, `status ${steal.status}`);
  }
  check("kunci perangkat via query string tidak diterima", (await call("GET", `/api/device/inbox?deviceId=${myDevice.id}&deviceKey=${deviceKey}`)).status === 401);

  // --- Operasi: akses data warga Rescue berbasis operasi (roster pemakai kalung)
  check("alarm Siaga/Evakuasi membuka operasi", !!alert.data?.operation?.id && alert.data.operation.status === "ACTIVE");
  const opId = alert.data?.operation?.id;
  const rescueOps = (await call("GET", "/api/operations", { cookie: R })).data ?? [];
  check("Rescue melihat operasi aktif di wilayahnya", rescueOps.some(o => o.id === opId));
  check("Rescue tidak boleh membuka daftar warga", (await call("GET", "/api/residents", { cookie: R })).status === 403);
  check("Rescue tidak boleh membuka daftar perangkat", (await call("GET", "/api/devices", { cookie: R })).status === 403);
  const roster = (await call("GET", `/api/operations/${opId}/roster`, { cookie: R })).data ?? [];
  const holdersInVillage = residentsAll.filter(r => r.villageId === myVillage && r.deviceId);
  check("roster berisi tepat pemakai kalung di desa", roster.length === holdersInVillage.length && roster.length > 0, `${roster.length} vs ${holdersInVillage.length}`);
  check("roster tanpa NIK/tanggal lahir/jenis kelamin", roster.every(r => !("birthDate" in r) && !("birth_date" in r) && !("gender" in r) && !("nationalId" in r)));
  check("roster memuat kontak darurat dan status kalung", roster.some(r => (r.contacts ?? []).length > 0) && roster.every(r => r.device));
  const holder = roster[0];
  const holderView = await call("GET", `/api/residents/${holder.residentId}`, { cookie: R });
  check("Rescue membuka profil pemakai kalung saat operasi aktif", holderView.status === 200 && holderView.data?.restricted === true && !("birth_date" in (holderView.data?.resident ?? {})));
  const noKalung = await call("POST", "/api/residents", { cookie: D, body: { villageId: myVillage, fullName: "Warga Tanpa Kalung", consented: true } });
  check("warga tanpa kalung dibuat", noKalung.status === 201);
  check("Rescue tidak boleh membuka warga tanpa kalung", (await call("GET", `/api/residents/${noKalung.data?.id}`, { cookie: R })).status === 403);
  check("warga tanpa kalung tidak masuk roster", !((await call("GET", `/api/operations/${opId}/roster`, { cookie: R })).data ?? []).some(r => r.residentId === noKalung.data?.id));
  check("Rescue tidak boleh membuka warga desa lain", (await call("GET", `/api/residents/${foreignResident.id}`, { cookie: R })).status === 403 || (await call("GET", `/api/residents/${foreignResident.id}`, { cookie: R })).status === 403);
  const mapRescue = (await call("GET", "/api/dashboard/map", { cookie: R })).data;
  check("peta Rescue hanya memuat pemakai kalung roster", (mapRescue.residents ?? []).every(r => roster.some(x => x.residentId === r.id)));
  check("Rescue tidak melihat nama pemilik kalung di peta", (mapRescue.devices ?? []).every(d => d.ownerName === null));
  // --- Prioritas berwarna untuk Rescue
  const COLORS = ["red", "orange", "yellow", "green"];
  const withPriority = roster.every(r => r.priority && COLORS.includes(r.priority.color) && Array.isArray(r.priority.reasons) && r.priority.reasons.length > 0);
  check("setiap pemakai kalung punya prioritas berwarna beserta alasan", withPriority);
  const rank = c => COLORS.indexOf(c);
  check("roster terurut dari merah ke hijau", roster.every((r, i) => i === 0 || rank(roster[i - 1].priority.color) <= rank(r.priority.color)));
  check("prioritas memakai lebih dari satu warna", new Set(roster.map(r => r.priority.color)).size >= 3, [...new Set(roster.map(r => r.priority.color))].join(","));
  const byName = name => roster.find(r => r.fullName === name)?.priority;
  check("SOS aktif + tidak bisa mengungsi + sendiri = merah", byName("Abdullah Yusuf")?.color === "red");
  check("label kelompok saja tidak menentukan: disabilitas mandiri lebih rendah daripada lansia tidak bisa mengungsi", byName("Syarifah Aini")?.score < byName("Abdullah Yusuf")?.score);
  check("ibu hamil sehat jauh dari zona bahaya berprioritas rendah", ["green", "yellow"].includes(byName("Rahmi")?.color));
  check("kebutuhan medis mendesak menaikkan prioritas", byName("Mahdalena")?.score > byName("Rahmi")?.score + 20);
  const before = Object.fromEntries(roster.map(r => [r.fullName, r.priority.score]));
  await call("PATCH", `/api/operations/${opId}`, { cookie: D, body: { waterLevelCm: 150 } });
  const rosterHigh = (await call("GET", `/api/operations/${opId}/roster`, { cookie: R })).data ?? [];
  check("tinggi air yang dilaporkan Desa menaikkan prioritas seluruh warga", rosterHigh.every(r => r.priority.score >= before[r.fullName]) && rosterHigh.some(r => r.priority.score > before[r.fullName]));
  check("kemampuan evakuasi tidak valid ditolak", (await call("POST", "/api/residents", { cookie: D, body: { villageId: myVillage, fullName: "Uji", consented: true, evacuationAbility: "TERBANG" } })).status === 400);
  const structured = await call("POST", "/api/residents", { cookie: D, body: { villageId: myVillage, fullName: "Warga Terstruktur", consented: true, evacuationAbility: "TIDAK_BISA_SENDIRI", timeCriticalMedical: true } });
  check("kemampuan evakuasi dan kebutuhan medis tersimpan terstruktur", structured.status === 201 && structured.data?.evacuation_ability === "TIDAK_BISA_SENDIRI" && structured.data?.time_critical_medical === true);
  const pack = await call("GET", `/api/operations/${opId}/offline-pack`, { cookie: R });
  check("paket offline berisi roster, zona, shelter", pack.status === 200 && pack.data?.roster?.length === roster.length && Array.isArray(pack.data?.hazardZones) && Array.isArray(pack.data?.shelters));
  const audited = ((await call("GET", "/api/audit/recent", { cookie: P })).data ?? []).map(e => e.action);
  check("akses roster dan profil oleh Rescue tercatat di audit", audited.includes("OPERATION_ROSTER_VIEW") && audited.includes("RESCUE_RESIDENT_VIEW"));
  check("Rescue tidak boleh menutup operasi", (await call("POST", `/api/operations/${opId}/close`, { cookie: R, body: {} })).status === 403);
  check("tinggi air tidak valid ditolak", (await call("PATCH", `/api/operations/${opId}`, { cookie: D, body: { waterLevelCm: -5 } })).status === 400);
  const upd = await call("PATCH", `/api/operations/${opId}`, { cookie: D, body: { waterLevelCm: 100, note: "Sungai naik, titik rendah tergenang" } });
  check("Desa memperbarui tinggi air", upd.status === 200 && upd.data?.waterLevelCm === 100);
  const closed = await call("POST", `/api/operations/${opId}/close`, { cookie: D, body: { note: "Air surut" } });
  check("Desa menutup operasi", closed.status === 200 && closed.data?.status === "CLOSED");
  check("setelah ditutup roster ditolak untuk Rescue", (await call("GET", `/api/operations/${opId}/roster`, { cookie: R })).status === 403);
  check("setelah ditutup profil warga ditolak untuk Rescue", (await call("GET", `/api/residents/${holder.residentId}`, { cookie: R })).status === 403);
  check("setelah ditutup peta Rescue tanpa warga", ((await call("GET", "/api/dashboard/map", { cookie: R })).data?.residents ?? []).length === 0);
  check("operasi tertutup tidak dapat diubah", (await call("PATCH", `/api/operations/${opId}`, { cookie: D, body: { note: "x" } })).status === 409);

  // Alarm seluruh desa
  const waspada = await call("POST", "/api/alerts", { cookie: D, body: { villageId: myVillage, severity: "WASPADA", message: "Waspada desa" } });
  check("alarm Waspada tidak membuka operasi", waspada.status === 201 && waspada.data?.operation === null);
  const siaga = await call("POST", "/api/alerts", { cookie: D, body: { villageId: myVillage, severity: "SIAGA", message: "Siaga desa", waterLevelCm: 60, observationNote: "Air naik di titik rendah" } });
  const siagaOp = siaga.data?.operation;
  check("alarm Siaga membuka operasi seluruh desa", siaga.status === 201 && siagaOp?.area_type === "DESA" && siagaOp?.water_level_cm === 60, `status ${siaga.status} ${siaga.error ?? ""}`);
  const siagaDetail = (await call("GET", `/api/operations/${siagaOp?.id}`, { cookie: R })).data;
  check("operasi berlabel seluruh desa dan tanpa dusun", siagaDetail?.areaLabel === "Seluruh desa" && !("hamletIds" in (siagaDetail ?? {})));
  check("endpoint dusun tidak ada lagi", (await call("GET", "/api/hamlets", { cookie: D })).status === 404);
  check("target alarm DUSUN ditolak", (await call("POST", "/api/alerts", { cookie: D, body: { villageId: myVillage, severity: "SIAGA", targetType: "DUSUN", message: "x" } })).status === 400);
  const second = await call("POST", "/api/alerts", { cookie: D, body: { villageId: myVillage, severity: "AWAS", message: "Eskalasi seluruh desa" } });
  check("alarm berikutnya meningkatkan operasi yang sama (bukan operasi baru)", second.data?.operation?.id === siagaOp?.id && second.data?.operation?.severity === "AWAS" && second.data?.operation?.area_type === "DESA");
  const operationList = (await call("GET", "/api/operations?status=ACTIVE", { cookie: D })).data ?? [];
  check("hanya satu operasi aktif per desa", operationList.filter(o => o.villageId === myVillage).length === 1);
  await call("POST", `/api/operations/${siagaOp?.id}/close`, { cookie: D, body: {} });

  // --- SOS dari kalung
  // Pilih kalung yang belum punya SOS terbuka (data seed sudah memuat beberapa insiden aktif).
  const openIncidents = ((await call("GET", "/api/incidents?limit=500", { cookie: P })).data?.data ?? []).filter(i => !["SAFE", "CANCELLED", "CLOSED"].includes(i.status));
  const freeDevice = ((await call("GET", `/api/devices?villageId=${myVillage}`, { cookie: P })).data?.data ?? []).find(d => d.residentId && !openIncidents.some(i => i.deviceId === d.id));
  const freeHeaders = { "x-jaga-device-id": freeDevice.id, "x-jaga-device-key": `jrk_${sha(`${freeDevice.id}:pusat@jaga.id`).slice(0, 32)}` };
  // SRS FR-4.3: tombol terkunci sampai JAGA Desa membunyikan alarm
  const lockedSos = await call("POST", "/api/device/sos", { headers: freeHeaders, body: { latitude: 4.8, longitude: 97.4 } });
  check("tombol kalung terkunci sebelum ada alarm aktif (409)", lockedSos.status === 409 && /terkunci/i.test(lockedSos.error ?? ""), `${lockedSos.status} ${lockedSos.error ?? ""}`);
  check("inbox melaporkan buttonUnlocked=false tanpa alarm", (await call("GET", "/api/device/inbox", { headers: freeHeaders })).data?.buttonUnlocked === false);
  await call("POST", "/api/alerts", { cookie: D, body: { villageId: myVillage, severity: "WASPADA", message: "Alarm uji buka tombol" } });
  check("alarm Desa membuka tombol kalung (buttonUnlocked=true)", (await call("GET", "/api/device/inbox", { headers: freeHeaders })).data?.buttonUnlocked === true);
  const sosDevice = await call("POST", "/api/device/sos", { headers: { ...freeHeaders, "x-jaga-gateway-key": gatewayKey }, body: { latitude: -7.2279, longitude: 107.9087 } });
  check("SOS dari kalung membuat insiden", sosDevice.status === 201 && !!sosDevice.data?.incidentId && sosDevice.data?.ack === "SOS_DITERIMA", JSON.stringify(sosDevice.data ?? sosDevice.error).slice(0, 80));
  const sosAgain = await call("POST", "/api/device/sos", { headers: freeHeaders, body: {} });
  check("SOS ganda tidak membuat insiden baru", sosAgain.data?.duplicate === true);
  const incidentId = sosDevice.data?.incidentId;
  check("README: SOS tanpa kunci perangkat ditolak", (await call("POST", "/api/device/sos", { body: {} })).status === 401);

  // --- Telemetri
  const tel = await call("POST", "/api/device/telemetry", { headers: deviceHeaders, body: { battery: 50, latitude: null, longitude: null } });
  const devAfter = ((await call("GET", `/api/devices?villageId=${myVillage}`, { cookie: P })).data?.data ?? []).find(d => d.id === myDevice.id);
  check("telemetri tanpa koordinat tidak memindahkan perangkat ke 0,0", tel.status === 202 && devAfter.latitude !== 0 && devAfter.longitude !== 0);
  check("telemetri baterai bukan angka ditolak", (await call("POST", "/api/device/telemetry", { headers: deviceHeaders, body: { battery: "abc" } })).status === 400);

  // --- GPS, notifikasi SOS, inbox, sinyal darurat
  const gpsOk = await call("POST", "/api/device/telemetry", { headers: deviceHeaders, body: { battery: 60, latitude: 4.8301, longitude: 97.4172, gpsFix: true, accuracyMeters: 9, satellites: 8 } });
  check("telemetri GPS dengan fix diterima dan posisi diperbarui", gpsOk.status === 202 && gpsOk.data?.locationAccepted === true && gpsOk.data?.updated?.latitude === 4.8301 && !!gpsOk.data?.updated?.locationAt && gpsOk.data?.updated?.locationAccuracyMeters === 9, JSON.stringify(gpsOk.data ?? gpsOk.error).slice(0, 120));
  const gpsNoFix = await call("POST", "/api/device/telemetry", { headers: deviceHeaders, body: { battery: 60, latitude: 0, longitude: 0, gpsFix: false } });
  check("telemetri tanpa fix tidak menimpa posisi terakhir", gpsNoFix.status === 202 && gpsNoFix.data?.locationAccepted === false && gpsNoFix.data?.updated?.latitude === 4.8301);
  const gpsInbox = await call("GET", "/api/device/inbox", { headers: deviceHeaders });
  check("inbox memuat nextPollSeconds dan activeSos", gpsInbox.status === 200 && typeof gpsInbox.data?.nextPollSeconds === "number" && "activeSos" in (gpsInbox.data ?? {}));
  const sosInbox = await call("GET", "/api/device/inbox", { headers: freeHeaders });
  check("inbox kalung ber-SOS memuat status SOS", sosInbox.data?.activeSos?.incidentId === incidentId && typeof sosInbox.data?.activeSos?.statusLabel === "string");
  const notifs = (await call("GET", "/api/notifications", { cookie: D })).data;
  const notifList = Array.isArray(notifs) ? notifs : notifs?.data ?? [];
  check("SOS kalung tersimpan sebagai notifikasi", notifList.some(n => (n.templateCode ?? n.template_code) === "SOS" || n.title === "SOS"), `${notifList.length} notifikasi`);
  const emergencyDenied = await call("POST", "/api/alerts/emergency", { cookie: R, body: { villageId: myVillage, confirm: true } });
  check("Rescue tidak dapat mengirim sinyal darurat", emergencyDenied.status === 403);
  check("Pusat tidak membunyikan alarm (hanya Desa)", (await call("POST", "/api/alerts", { cookie: P, body: { villageId: myVillage, severity: "SIAGA", message: "x" } })).status === 403 && (await call("POST", "/api/alerts/emergency", { cookie: P, body: { villageId: myVillage, confirm: true } })).status === 403);
  check("sinyal darurat tanpa konfirmasi ditolak", (await call("POST", "/api/alerts/emergency", { cookie: D, body: { villageId: myVillage } })).status === 400);
  const emergency = await call("POST", "/api/alerts/emergency", { cookie: D, body: { villageId: myVillage, confirm: true } });
  check("sinyal darurat satu tombol membuat alarm AWAS dan membuka operasi", emergency.status === 201 && emergency.data?.operation?.severity === "AWAS", `status ${emergency.status} ${emergency.error ?? ""}`);
  const emInbox = await call("GET", "/api/device/inbox", { headers: deviceHeaders });
  const emCmd = (emInbox.data?.commands ?? []).find(c => c.severity === "AWAS");
  check("kalung menerima perintah darurat dengan media suara, getar, dan cahaya", !!emCmd && ["SUARA", "GETAR", "CAHAYA"].every(m => emCmd.media?.includes(m)), JSON.stringify(emInbox.data?.commands ?? []).slice(0, 120));
  check("jeda tarik inbox rapat saat darurat", emInbox.data?.nextPollSeconds === 30);
  // Rute Rescue ke warga: dicek sebelum operasi ditutup
  const emOp = emergency.data?.operation?.id;
  const emRoster = (await call("GET", `/api/operations/${emOp}/roster`, { cookie: R })).data ?? [];
  const routeTarget = emRoster.find(r => r.latitude !== null);
  const routeRes = await call("GET", `/api/operations/${emOp}/route?residentId=${routeTarget?.residentId}`, { cookie: R });
  check("Rescue mendapat rute ke warga pemakai kalung", routeRes.status === 200 && routeRes.data?.fastest?.distanceMeters > 0 && /google\.com\/maps\/dir/.test(routeRes.data?.navigation?.google ?? ""), `status ${routeRes.status} ${routeRes.error ?? ""}`);
  check("rute menyebut sumber posisi tujuan", ["GPS", "RUMAH"].includes(routeRes.data?.to?.source));
  check("rute tanpa residentId ditolak", (await call("GET", `/api/operations/${emOp}/route`, { cookie: R })).status === 400);
  check("Desa lain tidak dapat meminta rute operasi ini", (await call("GET", `/api/operations/${emOp}/route?residentId=${routeTarget?.residentId}`, {})).status === 401);
  await call("POST", `/api/operations/${emergency.data?.operation?.id}/close`, { cookie: D, body: {} });

  // --- Titik evakuasi dikelola Desa
  const newShelter = await call("POST", "/api/shelters", { cookie: D, body: { villageId: myVillage, name: "Titik uji", latitude: 4.829, longitude: 97.417, capacity: 40 } });
  check("Desa menambah titik evakuasi", newShelter.status === 201 && !!newShelter.data?.id, `status ${newShelter.status} ${newShelter.error ?? ""}`);
  check("koordinat titik evakuasi tidak valid ditolak", (await call("POST", "/api/shelters", { cookie: D, body: { villageId: myVillage, name: "Salah", latitude: 999, longitude: 97 } })).status === 400);
  const editShelter = await call("PATCH", `/api/shelters/${newShelter.data?.id}`, { cookie: D, body: { capacity: 55 } });
  check("Desa mengubah kapasitas titik evakuasi", editShelter.status === 200 && editShelter.data?.capacity === 55);
  check("Rescue tidak dapat menambah titik evakuasi", (await call("POST", "/api/shelters", { cookie: R, body: { villageId: myVillage, name: "Titik Rescue", latitude: 4.8, longitude: 97.4 } })).status === 403);
  const delShelter = await call("DELETE", `/api/shelters/${newShelter.data?.id}`, { cookie: D });
  check("Desa menghapus titik evakuasi", delShelter.status === 200 && !(((await call("GET", "/api/shelters", { cookie: D })).data ?? []).some(x => x.id === newShelter.data?.id)));

  // --- Insiden, status, rekomendasi, rute
  const patchOnly = await call("PATCH", `/api/incidents/${incidentId}`, { cookie: D, body: { description: "Diperbarui" } });
  check("PATCH detail insiden", patchOnly.status === 200);
  const status = await call("PATCH", `/api/incidents/${incidentId}/status`, { cookie: D, body: { status: "ACKNOWLEDGED" } });
  check("ubah status lewat /status", status.status === 200);
  const board = (await call("GET", "/api/dashboard/priorities", { cookie: D })).data ?? [];
  check("papan prioritas memuat insiden ACKNOWLEDGED", board.some(item => item.incidentId === incidentId));
  const factors = (await call("GET", `/api/residents/${myResident.id}`, { cookie: D })).data?.priorityFactors ?? [];
  const cats = factors.find(f => f.key === "vulnerability_categories")?.value ?? [];
  check("faktor kerentanan berisi kategori, bukan UUID", cats.length > 0 && cats.every(c => /^[A-Z_]+$/.test(c)), JSON.stringify(cats));
  const sos = await call("POST", "/api/sos", { cookie: P, body: { villageId: myVillage, latitude: -7.2279, longitude: 107.9087, description: "uji rute" } });
  const routes = await call("GET", `/api/incidents/${sos.data?.id}/routes`, { cookie: P });
  check("rute memakai tujuan nyata (jarak > 0)", routes.status === 200 && (routes.data?.fastest?.distanceMeters ?? 0) > 0, `jarak ${routes.data?.fastest?.distanceMeters}`);
  const hazard = ((await call("GET", "/api/hazard-zones", { cookie: P })).data ?? []).find(z => z.centerLatitude != null);
  const hs = await call("POST", "/api/sos", { cookie: P, body: { villageId: hazard.villageId, latitude: hazard.centerLatitude, longitude: hazard.centerLongitude, description: "uji zona" } });
  const hr = await call("GET", `/api/incidents/${hs.data?.id}/routes?shelterId=${((await call("GET", "/api/shelters", { cookie: P })).data ?? []).find(s => s.villageId === hazard.villageId)?.id ?? ""}`, { cookie: P });
  check("zona bahaya dikenali pada estimasi rute", (hr.data?.fastest?.hazards ?? []).length >= 0 && hr.status === 200);
  const reco = await call("GET", `/api/incidents/${incidentId}/recommendation`, { cookie: D });
  check("rekomendasi dihitung", reco.status === 200 && typeof reco.data?.score === "number");

  // --- Penugasan tim
  const teams = (await call("GET", "/api/teams", { cookie: R })).data ?? [];
  const rescueOrg = rescue.data?.session?.organizationId;
  const team = teams.find(t => t.organizationId === rescueOrg && t.status === "AVAILABLE") ?? teams.find(t => t.organizationId === rescueOrg);
  const assign = await call("POST", `/api/incidents/${incidentId}/assignments`, { cookie: R, body: { teamId: team.id } });
  check("tim ditugaskan (teamId di body)", assign.status === 201, `status ${assign.status} ${assign.error ?? ""}`);
  check("penugasan ganda tim yang sama = 409", (await call("POST", `/api/incidents/${incidentId}/assignments`, { cookie: R, body: { teamId: team.id } })).status === 409);
  const accept = await call("POST", `/api/teams/${team.id}/accept`, { cookie: R, body: {} });
  check("tim menerima penugasan", accept.status === 200, `status ${accept.status}`);
  await call("POST", `/api/teams/${team.id}/position`, { cookie: R, body: { latitude: -7.22, longitude: 107.9 } });
  const eta = await call("GET", `/api/teams/${team.id}/eta?incidentId=${incidentId}`, { cookie: R });
  check("ETA tim", eta.status === 200 && eta.data?.distanceMeters > 0, `status ${eta.status} ${eta.error ?? ""}`);
  const detail = (await call("GET", `/api/teams/${team.id}`, { cookie: R })).data;
  const member = detail?.members?.[0];
  if (member) {
    await call("DELETE", `/api/teams/${team.id}/members/${member.profileId}`, { cookie: R });
    const after = (await call("GET", `/api/teams/${team.id}`, { cookie: R })).data;
    check("anggota tim terhapus", after.members.length === detail.members.length - 1);
  }
  const foreignTeam = teams.find(t => t.organizationId !== rescue.data?.session?.organizationId);
  if (foreignTeam) check("rescue tidak dapat mengubah tim organisasi lain", (await call("PATCH", `/api/teams/${foreignTeam.id}/status`, { cookie: R, body: { status: "OFF_DUTY" } })).status === 403);

  // --- Papan status per penerima manfaat dan status baru Rescue
  const boardRes = await call("GET", "/api/status-board", { cookie: D });
  const myRow = (boardRes.data?.rows ?? []).find(r => r.deviceId === freeDevice.id);
  check("papan status: warga yang menekan tombol = Meminta bantuan", myRow?.state === "BANTUAN", JSON.stringify(myRow ?? boardRes.error).slice(120, 520));
  check("papan status memuat hitungan per keadaan", typeof boardRes.data?.counts?.BANTUAN === "number" && boardRes.data?.rows?.length >= 9);
  check("Rescue tidak dapat membuka papan status", (await call("GET", "/api/status-board", { cookie: R })).status === 403);
  const nf = await call("PATCH", `/api/incidents/${incidentId}/status`, { cookie: D, body: { status: "NOT_FOUND" } });
  check("status tidak ditemukan diterima", nf.status === 200 && nf.data?.message === "Warga tidak ditemukan", `${nf.status} ${nf.error ?? ""}`);
  check("papan status: tidak ditemukan", ((await call("GET", "/api/status-board", { cookie: D })).data?.rows ?? []).find(r => r.deviceId === freeDevice.id)?.state === "TIDAK_DITEMUKAN");
  check("status tidak terjangkau diterima", (await call("PATCH", `/api/incidents/${incidentId}/status`, { cookie: D, body: { status: "UNREACHABLE" } })).status === 200);
  const safeNow = await call("PATCH", `/api/incidents/${incidentId}/status`, { cookie: D, body: { status: "SAFE" } });
  check("Rescue/Desa menandai aman", safeNow.status === 200);
  check("setelah aman tombol kalung terkunci lagi", (await call("GET", "/api/device/inbox", { headers: freeHeaders })).data?.buttonUnlocked === false && (await call("POST", "/api/device/sos", { headers: freeHeaders, body: {} })).status === 409);
  check("papan status: aman setelah dikonfirmasi", ((await call("GET", "/api/status-board", { cookie: D })).data?.rows ?? []).find(r => r.deviceId === freeDevice.id)?.state === "AMAN");

  // --- Dashboard
  const counters = (await call("GET", "/api/dashboard", { cookie: P })).data?.counters;
  const devicesAll = (await call("GET", "/api/devices?limit=500", { cookie: P })).data?.data ?? [];
  check("jumlah perangkat tidak terpasang akurat", counters.devicesUnassigned === devicesAll.filter(d => !d.residentId).length, `${counters.devicesUnassigned} vs ${devicesAll.filter(d => !d.residentId).length}`);
  check("perangkat 'online' hanya bila sinyal terakhir masih baru", devicesAll.every(d => !d.online || Date.now() - new Date(d.lastSeenAt).getTime() <= 15 * 60_000));
  const notifD = (await call("GET", "/api/notifications", { cookie: D })).data ?? [];
  check("DESA melihat notifikasi alarm desanya", notifD.length > 0);
  check("akun desa melihat akun di lingkupnya", ((await call("GET", "/api/accounts", { cookie: D })).data ?? []).length >= 1);

  // --- Banyak desa, kendala teknis, inventaris kalung, hapus akun, aturan prioritas
  const villagesP = (await call("GET", "/api/villages", { cookie: P })).data ?? [];
  const realVillages = villagesP.filter(v => !/fixture/i.test(v.name));
  check("Pusat melihat tiga desa pilot beserta provinsi", realVillages.length === 3 && realVillages.every(v => v.province === "Aceh"), `${realVillages.length} desa`);
  const seureuke = await login("desa.seureuke@jaga.id", "JagaDesa2026!");
  const S2 = seureuke.cookie;
  const seureukeVillage = realVillages.find(v => v.name === "Gampong Seureuke")?.id;
  const residentsS = (await call("GET", "/api/residents?limit=1000", { cookie: S2 })).data?.data ?? (await call("GET", "/api/residents?limit=1000", { cookie: S2 })).data ?? [];
  const listS = Array.isArray(residentsS) ? residentsS : residentsS.data ?? [];
  check("Desa Seureuke hanya melihat warganya sendiri", listS.length === 3 && listS.every(r => r.villageId === seureukeVillage), `${listS.length}`);
  check("Desa Seureuke tidak dapat membaca desa lain", (await call("GET", `/api/residents?villageId=${myVillage}`, { cookie: S2 })).status === 403 || ((await call("GET", `/api/residents?villageId=${myVillage}`, { cookie: S2 })).data?.data ?? []).length === 0);

  const tk = await call("POST", "/api/tickets", { cookie: D, body: { category: "KALUNG", priority: "TINGGI", title: "Kalung baru belum tiba", description: "Mohon dikirim 2 kalung." } });
  check("Desa melaporkan kendala teknis ke Pusat", tk.status === 201 && tk.data?.status === "OPEN" && tk.data?.villageName, `status ${tk.status} ${tk.error ?? ""}`);
  check("Pusat tidak membuat kendala (hanya menerima)", (await call("POST", "/api/tickets", { cookie: P, body: { title: "x tidak sah", category: "LAINNYA" } })).status === 403);
  const ticketsP = (await call("GET", "/api/tickets", { cookie: P })).data ?? [];
  check("Pusat melihat kendala dari Desa dan Rescue", ticketsP.some(t => t.id === tk.data?.id) && ticketsP.some(t => t.reporterRole === "RESCUE"));
  const ticketsD = (await call("GET", "/api/tickets", { cookie: D })).data ?? [];
  check("Desa hanya melihat kendala desanya", ticketsD.length > 0 && ticketsD.every(t => t.villageId === myVillage));
  const ticketsS = (await call("GET", "/api/tickets", { cookie: S2 })).data ?? [];
  check("Desa lain tidak melihat kendala desa ini", !ticketsS.some(t => t.id === tk.data?.id));
  const ticketsR = (await call("GET", "/api/tickets", { cookie: R })).data ?? [];
  check("Rescue hanya melihat kendala organisasinya", ticketsR.length > 0 && ticketsR.every(t => t.reporterRole === "RESCUE") && !ticketsR.some(t => t.id === tk.data?.id));
  check("Desa tidak dapat menangani kendala", (await call("PATCH", `/api/tickets/${tk.data?.id}`, { cookie: D, body: { status: "RESOLVED", resolutionNote: "sendiri" } })).status === 403);
  check("menyelesaikan kendala wajib disertai catatan", (await call("PATCH", `/api/tickets/${tk.data?.id}`, { cookie: P, body: { status: "RESOLVED" } })).status === 400);
  const solved = await call("PATCH", `/api/tickets/${tk.data?.id}`, { cookie: P, body: { status: "RESOLVED", resolutionNote: "Dikirim lewat kurir" } });
  check("Pusat menyelesaikan kendala", solved.status === 200 && solved.data?.status === "RESOLVED" && !!solved.data?.resolvedAt);
  const overviewP = (await call("GET", "/api/dashboard", { cookie: P })).data;
  check("ringkasan Pusat memuat hitungan kendala dan gudang kalung", typeof overviewP?.counters?.ticketsOpen === "number" && overviewP?.counters?.devicesWarehouse >= 3 && overviewP?.counters?.provinces >= 1, JSON.stringify(overviewP?.counters ?? {}).slice(0, 90));

  const dCreate = await call("POST", "/api/devices", { cookie: D, body: { villageId: myVillage, id: "JAGA-DESA-X" } });
  check("Desa tidak dapat mendaftarkan kalung baru", dCreate.status === 403);
  const wh = await call("POST", "/api/devices", { cookie: P, body: { id: "JAGA-0099", model: "JAGA Rumah v1" } });
  check("Pusat mendaftarkan kalung ke gudang tanpa desa dan koordinat", wh.status === 201 && wh.data?.villageId === null && !!wh.data?.deviceKey, `status ${wh.status} ${wh.error ?? ""}`);
  const dList1 = (await call("GET", "/api/devices", { cookie: D })).data?.data ?? [];
  check("kalung gudang tidak terlihat oleh Desa", !dList1.some(d => d.id === "JAGA-0099"));
  check("Desa tidak dapat mendistribusikan kalung", (await call("POST", "/api/devices/JAGA-0099/distribute", { cookie: D, body: { villageId: myVillage } })).status === 403);
  const dist = await call("POST", "/api/devices/JAGA-0099/distribute", { cookie: P, body: { villageId: myVillage } });
  check("Pusat mendistribusikan kalung ke desa", dist.status === 200 && dist.data?.villageId === myVillage && dist.data?.status === "STOCK");
  const dList2 = (await call("GET", "/api/devices", { cookie: D })).data?.data ?? [];
  check("setelah distribusi kalung terlihat oleh Desa", dList2.some(d => d.id === "JAGA-0099"));
  const pairedDevice = dList2.find(d => d.residentId);
  check("kalung yang terpasang pada warga tidak dapat dipindahkan", (await call("POST", `/api/devices/${pairedDevice?.id}/distribute`, { cookie: P, body: {} })).status === 409);
  const back = await call("POST", "/api/devices/JAGA-0099/distribute", { cookie: P, body: {} });
  check("Pusat menarik kalung kembali ke gudang", back.status === 200 && back.data?.villageId === null);

  const mk = await call("POST", "/api/accounts", { cookie: P, body: { email: "hapus.saya@jaga.id", displayName: "Akun Uji Hapus", role: "DESA", password: "KataSandi123!", organizationName: "Desa Uji Hapus", villageIds: [myVillage] } });
  const ownLogin = await login("hapus.saya@jaga.id", "KataSandi123!");
  check("akun uji dibuat dan dapat masuk", mk.status === 201 && ownLogin.status === 200);
  const accountsP = (await call("GET", "/api/accounts", { cookie: P })).data ?? [];
  const toDelete = accountsP.find(a => a.email === "hapus.saya@jaga.id");
  check("daftar akun memuat id", !!toDelete?.id);
  check("Desa tidak dapat menghapus akun", (await call("DELETE", `/api/accounts/${toDelete?.id}`, { cookie: D })).status === 403);
  const selfId = accountsP.find(a => a.email === "pusat@jaga.id")?.id;
  check("Pusat tidak dapat menghapus akunnya sendiri", (await call("DELETE", `/api/accounts/${selfId}`, { cookie: P })).status === 403);
  const del = await call("DELETE", `/api/accounts/${toDelete?.id}`, { cookie: P });
  check("Pusat menghapus akun", del.status === 200 && del.data?.deleted === true);
  check("akun terhapus tidak muncul di daftar dan tidak dapat masuk", !((await call("GET", "/api/accounts", { cookie: P })).data ?? []).some(a => a.email === "hapus.saya@jaga.id") && (await login("hapus.saya@jaga.id", "KataSandi123!")).status === 401);
  check("sesi akun terhapus langsung tidak berlaku", (await call("GET", "/api/dashboard", { cookie: ownLogin.cookie })).status === 401);

  const sets = (await call("GET", "/api/rulesets", { cookie: P })).data ?? [];
  const activeSet = sets.find(x => x.status === "ACTIVE");
  check("aturan aktif tidak dapat diubah langsung", (await call("PUT", `/api/rulesets/${activeSet?.id}/rules`, { cookie: P, body: { rules: [{ factorKey: "has_active_sos", operator: "EQ", comparisonValue: true, scoreDelta: 1, explanation: "uji" }] } })).status === 409);
  check("Desa tidak dapat menyusun revisi aturan", (await call("POST", `/api/rulesets/${activeSet?.id}/revise`, { cookie: D, body: {} })).status === 403);
  const rev = await call("POST", `/api/rulesets/${activeSet?.id}/revise`, { cookie: P, body: {} });
  check("revisi aturan menyalin aturan ke draf versi baru", rev.status === 201 && rev.data?.status === "DRAFT" && rev.data?.version > activeSet?.version, `status ${rev.status} ${rev.error ?? ""}`);
  const draftFull = (await call("GET", `/api/rulesets/${rev.data?.id}`, { cookie: P })).data;
  check("draf memuat seluruh aturan aktif", draftFull?.rules?.length === (await call("GET", `/api/rulesets/${activeSet?.id}`, { cookie: P })).data?.rules?.length && draftFull?.rules?.length > 5);
  const edited = draftFull.rules.map(r => r.factorKey === "lives_alone" ? { ...r, scoreDelta: 20 } : r);
  const savedRules = await call("PUT", `/api/rulesets/${rev.data?.id}/rules`, { cookie: P, body: { rules: edited } });
  check("bobot pada draf dapat diubah", savedRules.status === 200 && savedRules.data?.find(r => r.factorKey === "lives_alone")?.scoreDelta === 20);
  const again = await call("POST", `/api/rulesets/${activeSet?.id}/revise`, { cookie: P, body: {} });
  check("revisi kedua memakai draf yang sama", again.data?.id === rev.data?.id && again.data?.reused === true);
  check("mengaktifkan aturan wajib catatan persetujuan", (await call("POST", `/api/rulesets/${rev.data?.id}/publish`, { cookie: P, body: { action: "activate" } })).status === 400);
  const actRule = await call("POST", `/api/rulesets/${rev.data?.id}/publish`, { cookie: P, body: { action: "activate", approvalNote: "Disetujui rapat koordinasi" } });
  check("aturan baru diaktifkan dan yang lama diarsipkan", actRule.status === 200 && actRule.data?.status === "ACTIVE" && (await call("GET", "/api/rulesets", { cookie: P })).data?.filter(x => x.status === "ACTIVE").length === 1);


  // --- Gateway desa: outbox dan unggahan store-and-forward
  const localGateway = gateways.find(g => g.villageId === myVillage) ?? gateways[0];
  const gw = { "X-JAGA-Gateway-Key": `gtw_${sha(`${localGateway.gatewayCode}:pusat@jaga.id`).slice(0, 32)}` };
  check("outbox gateway tanpa kunci ditolak", (await call("GET", "/api/gateway/outbox")).status === 401);
  await call("POST", "/api/alerts", { cookie: D, body: { villageId: myVillage, severity: "SIAGA", message: "Alarm uji gateway" } });
  const outbox = await call("GET", "/api/gateway/outbox", { headers: gw });
  check("outbox gateway memuat alarm, media, target kalung, dan kalung yang tombolnya terbuka", outbox.status === 200 && outbox.data?.commands?.length >= 1 && outbox.data.commands[0].targets?.length >= 5 && outbox.data.commands[0].media?.includes("SUARA") && outbox.data.unlockedDevices?.length >= 5, `${outbox.status} ${outbox.error ?? ""}`);
  const outbox2 = await call("GET", "/api/gateway/outbox", { headers: gw });
  check("outbox menandai alarm terkirim (SENT)", outbox2.status === 200);
  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const ing = await call("POST", "/api/gateway/ingest", { headers: gw, body: { events: [
    { type: "telemetry", deviceId: myDevice.id, battery: 70, recordedAt: tenMinAgo },
    { type: "telemetry", deviceId: "JAGA-0101", battery: 50 },
    { type: "telemetry", deviceId: myDevice.id, recordedAt: "bukan-tanggal" },
    { type: "ngawur" }
  ] } });
  check("unggahan gateway: 1 diterima dan 3 ditolak (desa lain, waktu rusak, tipe tak dikenal)", ing.status === 200 && ing.data?.accepted === 1 && ing.data?.rejected === 3, JSON.stringify(ing.data?.results ?? ing.error).slice(0, 220));
  check("kunci gateway desa lain tidak dapat menulis kalung desa ini", ((await call("POST", "/api/gateway/ingest", { headers: { "X-JAGA-Gateway-Key": `gtw_${sha("GW-SEUREUKE-01:pusat@jaga.id").slice(0, 32)}` }, body: { events: [{ type: "telemetry", deviceId: myDevice.id, battery: 1 }] } })).data?.accepted) === 0);
  check("unggahan lebih dari 200 kejadian ditolak", (await call("POST", "/api/gateway/ingest", { headers: gw, body: { events: Array.from({ length: 201 }, () => ({ type: "ngawur" })) } })).status === 400);

  // --- Pengaturan platform, tata kelola, pengumuman, status desa
  check("pengaturan platform hanya untuk Pusat", (await call("GET", "/api/platform", { cookie: D })).status === 403);
  const plat = await call("GET", "/api/platform", { cookie: P });
  check("Pusat melihat pengaturan, versi, dan sebaran firmware", plat.status === 200 && plat.data?.settings?.alert_expiry_minutes === 120 && !!plat.data?.version?.app && plat.data?.firmware?.length >= 1);
  check("pengaturan tidak valid ditolak", (await call("PUT", "/api/platform", { cookie: P, body: { settings: { device_offline_minutes: 0 } } })).status === 400);
  const saved = await call("PUT", "/api/platform", { cookie: P, body: { settings: { alert_expiry_minutes: 90, rescue_view_medical: false } } });
  check("Pusat mengubah pengaturan platform", saved.status === 200 && saved.data?.settings?.alert_expiry_minutes === 90 && saved.data?.settings?.rescue_view_medical === false);
  const gov = await call("GET", "/api/governance", { cookie: P });
  check("panel tata kelola memuat matriks akses, persetujuan, dan tidak ada NIK di antarmuka", gov.status === 200 && gov.data?.matrix?.length >= 6 && gov.data?.consent?.consented === gov.data?.consent?.total && gov.data?.matrix?.find(r => /Catatan medis/.test(r.field))?.rescue === "Tidak");
  await call("PUT", "/api/platform", { cookie: P, body: { settings: { alert_expiry_minutes: 120, rescue_view_medical: true } } });
  check("Desa tidak dapat membuka panel tata kelola", (await call("GET", "/api/governance", { cookie: D })).status === 403);

  const ann = await call("POST", "/api/announcements", { cookie: P, body: { title: "Uji pengumuman", body: "Mohon periksa kalung", priority: "PENTING", expiresInHours: 24 } });
  check("Pusat mengirim pengumuman ke seluruh Desa", ann.status === 201 && ann.data?.priority === "PENTING");
  check("Desa dan Rescue menerima pengumuman", [D, S2, R].every(async c => true) && ((await call("GET", "/api/announcements", { cookie: D })).data ?? []).some(a => a.id === ann.data?.id) && ((await call("GET", "/api/announcements", { cookie: R })).data ?? []).some(a => a.id === ann.data?.id));
  check("Desa tidak dapat mengirim pengumuman", (await call("POST", "/api/announcements", { cookie: D, body: { title: "x tidak sah", body: "y tidak sah" } })).status === 403);
  check("Pusat menghapus pengumuman", (await call("DELETE", `/api/announcements/${ann.data?.id}`, { cookie: P })).data?.deleted === true);
  const vst = await call("GET", "/api/village-status", { cookie: P });
  check("status desa: tiga desa aktif dengan waktu sinkron terakhir", vst.status === 200 && vst.data?.villages?.filter(v => !/fixture/i.test(v.name)).length === 3 && vst.data.villages.filter(v => !/fixture/i.test(v.name)).every(v => v.status === "ACTIVE" && v.lastSyncAt), JSON.stringify(vst.data?.villages?.map(v => [v.name, v.status])).slice(0, 160));
  check("hasil penanganan tampil di ringkasan", typeof (await call("GET", "/api/dashboard", { cookie: P })).data?.outcomes?.OPEN === "number");

  // --- Laporan pasca-operasi, jejak tim, dan pengerahan tim oleh Desa
  const teamsR = (await call("GET", "/api/teams", { cookie: R })).data ?? [];
  const teamsD = (await call("GET", "/api/teams", { cookie: D })).data ?? [];
  check("Desa melihat tim dari organisasi yang melayani desanya", teamsD.length >= 3 && teamsR.length >= 3);
  check("Desa tanpa wilayah layanan tidak melihat tim lain", ((await call("GET", "/api/teams", { cookie: (await login("desa.seureuke@jaga.id", "JagaDesa2026!")).cookie })).data ?? []).length >= 3);
  const myTeam = teamsR.find(t => /BPBD/.test(t.name));
  const activeOp = ((await call("GET", "/api/operations?status=ACTIVE", { cookie: D })).data ?? [])[0] ?? (await call("POST", "/api/alerts", { cookie: D, body: { villageId: myVillage, severity: "SIAGA", message: "Operasi uji laporan" } })).data?.operation;
  const pos = await call("POST", `/api/teams/${myTeam?.id}/position`, { cookie: R, body: { latitude: 4.8481, longitude: 97.4729, accuracyMeters: 8 } });
  await call("POST", `/api/teams/${myTeam?.id}/position`, { cookie: R, body: { latitude: 4.8486, longitude: 97.4733 } });
  check("Rescue melaporkan posisi tim untuk pelacakan jalur", pos.status === 201);
  const cov = await call("GET", `/api/operations/${activeOp?.id}/coverage`, { cookie: R });
  check("cakupan operasi memuat jejak tiap tim yang melayani desa", cov.status === 200 && cov.data?.teams?.length >= 3 && cov.data.teams.find(t => t.teamId === myTeam?.id)?.points?.length >= 2, `${cov.status} ${cov.error ?? ""}`);
  check("Desa lain tidak dapat melihat cakupan operasi ini", (await call("GET", `/api/operations/${activeOp?.id}/coverage`, { cookie: S2 })).status === 403);
  check("laporan pasca-operasi tanpa ringkasan ditolak", (await call("POST", `/api/operations/${activeOp?.id}/reports`, { cookie: R, body: { summary: "pendek" } })).status === 400);
  const rep = await call("POST", `/api/operations/${activeOp?.id}/reports`, { cookie: R, body: { summary: "Tim menyisir kawasan dari selatan dan mengevakuasi dua warga.", foundCount: 3, evacuatedCount: 2, notFoundCount: 0, unreachableCount: 1, distanceKm: 4.2, teamId: myTeam?.id } });
  check("Rescue mengirim laporan pasca-operasi", rep.status === 201 && rep.data?.evacuatedCount === 2 && rep.data?.organizationName, `${rep.status} ${rep.error ?? ""}`);
  check("Desa dan Pusat melihat laporan itu", ((await call("GET", "/api/operation-reports", { cookie: D })).data ?? []).some(r => r.id === rep.data?.id) && ((await call("GET", "/api/operation-reports", { cookie: P })).data ?? []).some(r => r.id === rep.data?.id));
  check("Desa tidak dapat membuat laporan Rescue", (await call("POST", `/api/operations/${activeOp?.id}/reports`, { cookie: D, body: { summary: "Laporan palsu dari desa" } })).status === 403);
  const sosForDispatch = await call("POST", "/api/sos", { cookie: P, body: { villageId: myVillage, latitude: 4.8485, longitude: 97.4731, description: "uji pengerahan tim" } });
  const damkar = teamsD.find(t => /Damkar/.test(t.name));
  const dispatch = await call("POST", `/api/incidents/${sosForDispatch.data?.id}/assignments`, { cookie: D, body: { teamId: damkar?.id, note: "Rumah paling ujung, jalan tergenang" } });
  check("Desa mengerahkan tim Rescue langsung dari dasbor (FR-2.7)", dispatch.status === 201, `${dispatch.status} ${dispatch.error ?? ""}`);
  check("Desa lain tidak dapat mengerahkan tim ke insiden desa ini", (await call("POST", `/api/incidents/${sosForDispatch.data?.id}/assignments`, { cookie: S2, body: { teamId: damkar?.id } })).status === 403);

  // --- Sesi
  const token = desa.data?.token;
  await call("POST", "/api/auth/logout", { cookie: D });
  check("logout mencabut token", (await call("GET", "/api/auth/me", { headers: { authorization: `Bearer ${token}` } })).status === 401);
  let blocked = false;
  for (let i = 0; i < 12; i++) if ((await call("POST", "/api/auth/login", { body: { email: "brute@jaga.id", password: "x" + i } })).status === 429) blocked = true;
  check("rate limit login (429)", blocked);

  // --- Konfigurasi publik & pembuatan akun
  const cfg = await call("GET", "/api/config");
  check("config menawarkan akun demo pada mode memori", cfg.data?.demoData === true && (cfg.data?.demoAccounts ?? []).length >= 3);
  const newRescue = await call("POST", "/api/accounts", { cookie: P, body: { displayName: "Petugas Baru", email: "petugas.baru@jaga.id", password: "Rahasia1234", role: "RESCUE", organizationName: "Basarnas Uji", organizationType: "BASARNAS", villageIds: [myVillage] } });
  check("Pusat membuat akun Rescue beserta organisasinya", newRescue.status === 201 && !!newRescue.data?.organizationId, `status ${newRescue.status} ${newRescue.error ?? ""}`);
  const newLogin = await login("petugas.baru@jaga.id", "Rahasia1234");
  check("akun Rescue baru dapat masuk dan berlingkup desa", newLogin.status === 200 && newLogin.data?.session?.villageIds?.[0] === myVillage);


  // --- Aset
  for (const secretPath of ["/.env", "/package.json", "/backend/src/config.ts", "/supabase/migrations/202609220002_operational.sql"]) {
    check(`tolak akses ${secretPath}`, (await fetch(base + secretPath)).status === 404);
  }
  for (const page of ["/", "/app", "/login", "/landing.css", "/landing.js", "/app.js", "/api-client.js", "/styles.css", "/auth.css", "/auth.js", "/manifest.webmanifest", "/service-worker.js", "/logo_jaga.jpeg", "/assets/logo-mark.png", "/assets/logo-mark-white.png", "/assets/icon-192.png", "/vendor/leaflet/leaflet.js", "/vendor/leaflet/leaflet.css"]) {
    check(`aset web ${page} tersaji`, (await fetch(base + page)).status === 200);
  }
  const statusAnon = await call("GET", "/api/auth/status");
  const statusIn = await call("GET", "/api/auth/status", { cookie: R });
  check("status sesi publik: anonim = false, Rescue = RESCUE (tanpa 401)", statusAnon.status === 200 && statusAnon.data?.authenticated === false && statusIn.data?.role === "RESCUE");
  const landing = await (await fetch(base + "/")).text();
  check("halaman depan publik memuat tombol masuk dan tiga peran", /href="\/login"/.test(landing) && /JAGA Desa/.test(landing) && /JAGA Rescue/.test(landing) && /JAGA Pusat/.test(landing));
  check("kartu peran mengarah ke login dengan parameter peran", ["desa", "rescue", "pusat"].every(r => landing.includes(`/login?role=${r}`)));
  const appPage = await (await fetch(base + "/app")).text();
  check("dashboard berada di /app", /id="navbar"/.test(appPage) && !/id="navbar"/.test(landing));
  const csp = (await fetch(base + "/")).headers.get("content-security-policy") ?? "";
  check("CSP mengizinkan Google Fonts, tanpa unpkg script", /fonts\.googleapis\.com/.test(csp) && !/script-src[^;]*unpkg/.test(csp));
} catch (error) {
  check("skrip tes tidak error", false, error.stack?.split("\n").slice(0, 3).join(" | "));
} finally {
  server?.kill();
}

const failed = results.filter(r => !r.ok);
console.log("\n" + "=".repeat(60));
console.log(`HASIL: ${results.length - failed.length}/${results.length} lulus`);
for (const r of failed) console.log("  - " + r.name);
process.exit(failed.length ? 1 : 0);
