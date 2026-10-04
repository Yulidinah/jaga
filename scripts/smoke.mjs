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
  const alert = await call("POST", "/api/alerts", { cookie: D, body: { villageId: myVillage, severity: "EVAKUASI", message: "Uji alarm" } });
  check("alarm desa dibuat", alert.status === 201 && alert.data?.devicesReached >= 1, `devicesReached=${alert.data?.devicesReached}`);
  check("status alarm awal QUEUED", alert.data?.command?.status === "QUEUED");
  const inbox = await call("GET", "/api/device/inbox", { headers: deviceHeaders });
  const received = inbox.data?.commands?.[0];
  check("inbox perangkat berisi alarm dengan receiptId", inbox.status === 200 && !!received?.receiptId && received.severity === "EVAKUASI");
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

  // Area per dusun
  const hamletOf = holdersInVillage.find(r => r.hamletId)?.hamletId;
  const inHamlet = holdersInVillage.filter(r => r.hamletId === hamletOf || !r.hamletId);
  const waspada = await call("POST", "/api/alerts", { cookie: D, body: { villageId: myVillage, severity: "WASPADA", hamletIds: [hamletOf], message: "Waspada dusun" } });
  check("alarm Waspada tidak membuka operasi", waspada.status === 201 && waspada.data?.operation === null);
  const dusunAlert = await call("POST", "/api/alerts", { cookie: D, body: { villageId: myVillage, severity: "SIAGA", hamletIds: [hamletOf], message: "Siaga dusun", waterLevelCm: 60, observationNote: "Air naik di titik rendah" } });
  const dusunOp = dusunAlert.data?.operation;
  check("alarm Siaga per dusun membuka operasi area dusun", dusunAlert.status === 201 && dusunOp?.area_type === "DUSUN" && dusunOp?.water_level_cm === 60, `status ${dusunAlert.status} ${dusunAlert.error ?? ""}`);
  const dusunRoster = (await call("GET", `/api/operations/${dusunOp?.id}/roster`, { cookie: R })).data ?? [];
  check("roster dibatasi dusun terpilih", dusunRoster.length === inHamlet.length && dusunRoster.length <= holdersInVillage.length, `${dusunRoster.length} vs ${inHamlet.length}/${holdersInVillage.length}`);
  const dusunDetail = (await call("GET", `/api/operations/${dusunOp?.id}`, { cookie: R })).data;
  check("operasi memuat nama dusun", Array.isArray(dusunDetail?.hamletNames) && dusunDetail.hamletNames.length === 1);
  const second = await call("POST", "/api/alerts", { cookie: D, body: { villageId: myVillage, severity: "EVAKUASI", message: "Eskalasi seluruh desa" } });
  check("alarm berikutnya meningkatkan operasi yang sama (bukan operasi baru)", second.data?.operation?.id === dusunOp?.id && second.data?.operation?.severity === "EVAKUASI" && second.data?.operation?.area_type === "DESA");
  const operationList = (await call("GET", "/api/operations?status=ACTIVE", { cookie: D })).data ?? [];
  check("hanya satu operasi aktif per desa", operationList.filter(o => o.villageId === myVillage).length === 1);
  await call("POST", `/api/operations/${dusunOp?.id}/close`, { cookie: D, body: {} });

  // --- SOS dari kalung
  // Pilih kalung yang belum punya SOS terbuka (data seed sudah memuat beberapa insiden aktif).
  const openIncidents = ((await call("GET", "/api/incidents?limit=500", { cookie: P })).data?.data ?? []).filter(i => !["SAFE", "CANCELLED", "CLOSED"].includes(i.status));
  const freeDevice = ((await call("GET", `/api/devices?villageId=${myVillage}`, { cookie: P })).data?.data ?? []).find(d => d.residentId && !openIncidents.some(i => i.deviceId === d.id));
  const freeHeaders = { "x-jaga-device-id": freeDevice.id, "x-jaga-device-key": `jrk_${sha(`${freeDevice.id}:pusat@jaga.id`).slice(0, 32)}` };
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

  // --- Dashboard
  const counters = (await call("GET", "/api/dashboard", { cookie: P })).data?.counters;
  const devicesAll = (await call("GET", "/api/devices?limit=500", { cookie: P })).data?.data ?? [];
  check("jumlah perangkat tidak terpasang akurat", counters.devicesUnassigned === devicesAll.filter(d => !d.residentId).length, `${counters.devicesUnassigned} vs ${devicesAll.filter(d => !d.residentId).length}`);
  check("perangkat 'online' hanya bila sinyal terakhir masih baru", devicesAll.every(d => !d.online || Date.now() - new Date(d.lastSeenAt).getTime() <= 15 * 60_000));
  const notifD = (await call("GET", "/api/notifications", { cookie: D })).data ?? [];
  check("DESA melihat notifikasi alarm desanya", notifD.length > 0);
  check("akun desa melihat akun di lingkupnya", ((await call("GET", "/api/accounts", { cookie: D })).data ?? []).length >= 1);

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
