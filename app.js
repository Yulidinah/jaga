const roleConfig = {
  pusat: { name: 'JAGA Pusat', eyebrow: 'RINGKASAN NASIONAL', title: 'Ketahanan yang terlihat, hingga tingkat desa', subtitle: 'Pantau perlindungan, kesiapan perangkat, dan respons wilayah.', nav: [['grid','Dashboard nasional'],['map','Monitoring desa'],['people','Data penerima manfaat'],['report','Laporan operasi'],['check','Tata kelola data'],['report','Log audit']] },
  desa: { name: 'JAGA Desa', eyebrow: 'DESA SUKAMAJU · KAB. GARUT', title: 'Pusat kendali Desa Sukamaju', subtitle: 'Validasi kondisi lokal, peringatkan warga, dan koordinasikan bantuan.', nav: [['grid','Dashboard bahaya'],['people','Data warga'],['bell','Trigger alarm'],['check','Status warga'],['signal','Kerahkan Rescue'],['device','Kesehatan device'],['report','Riwayat kejadian'],['map','Peta warga']] },
  rescue: { name: 'JAGA Rescue', eyebrow: 'OPERASI LAPANGAN', title: 'Respons dan evakuasi warga', subtitle: 'Sistem memberi informasi dan rekomendasi; komandan menentukan tindakan taktis.', nav: [['map','Peta operasi'],['bell','Feed bantuan'],['route','Navigasi rute'],['route','Jejak pencarian'],['check','Update status warga'],['people','Koordinasi tim'],['report','Laporan operasi']] }
};

const state = { role: new URLSearchParams(location.search).get('role') || 'desa', section: 0, dashboard: null, residents: [], devices: [], incidents: [], alerts: [], vulnerabilities: [], loading: true, error: '', alarm: { severity: 'SIAGA', target: 'ALL', message: '' } };
if (!roleConfig[state.role]) state.role = 'desa';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const icon = name => `<svg><use href="#i-${name}"/></svg>`;
const fmtDate = value => value ? new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : '—';
const initials = name => String(name || '?').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
const statusLabel = value => ({NEW:'SOS baru',ACKNOWLEDGED:'Dikonfirmasi',ASSIGNED:'Tim ditugaskan',EN_ROUTE:'Menuju lokasi',ARRIVED:'Tiba',EVACUATED:'Dievakuasi',SAFE:'Aman',CANCELLED:'Dibatalkan',CLOSED:'Selesai'}[value] || value || '—');
const activeIncident = incident => !['SAFE','CANCELLED','CLOSED'].includes(incident.status);
const riskClass = status => ['NEW','ACKNOWLEDGED'].includes(status) ? 'red' : ['SAFE','CLOSED'].includes(status) ? 'green' : '';

function pageHead(title, subtitle, eyebrow = roleConfig[state.role].eyebrow) {
  return `<div class="page-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="head-meta"><b>${new Intl.DateTimeFormat('id-ID',{dateStyle:'full'}).format(new Date())}</b><span>${state.dashboard ? `Diperbarui ${fmtDate(state.dashboard.lastUpdatedAt)}` : 'Memuat data…'}</span></div></div>`;
}
function metric(iconName, label, value, note, extra='') { return `<article class="metric ${extra}"><div class="metric-label"><span>${icon(iconName)}</span>${esc(label)}</div><strong>${esc(value)}</strong><small>${note}</small></article>`; }
function empty(message) { return `<div class="empty-state">${icon('check')}<b>${esc(message)}</b><small>Data akan muncul otomatis setelah tersedia.</small></div>`; }
function loading() { return `${pageHead('Memuat data JAGA','Mengambil informasi terbaru dari pusat data.')}<section class="panel loading-card">Memuat…</section>`; }
function failure() { return `${pageHead('Data belum dapat dimuat','Periksa koneksi backend dan Supabase.')}<section class="panel error-card"><b>${esc(state.error)}</b><button class="btn ghost" id="retryLoad">Coba lagi</button></section>`; }

function mapView(route=false) {
  const pins = state.residents.slice(0,4).map((r,i) => `<button class="pin ${i===0?'red':i===1?'amber':'green'} p${i+1}" title="${esc(r.fullName)}" data-resident="${esc(r.id)}"></button>`).join('');
  return `<div class="map"><div class="river"></div><div class="road"></div>${route?'<div class="route-line"></div>':''}<span class="map-label a">DUSUN CEMPAKA</span><span class="map-label b">PASAR DESA</span><span class="map-label c">BALAI DESA</span>${pins}<div class="map-legend"><span>SOS baru</span><span>Ditangani</span><span>Aman</span></div></div>`;
}

function renderDashboard() {
  const r = roleConfig[state.role], d = state.dashboard;
  if (state.role === 'pusat') return `${pageHead(r.title,r.subtitle)}<section class="grid metrics">${metric('people','Penerima manfaat',d.residents,'Profil aktif')}${metric('map','Wilayah demo','1','Desa terhubung')}${metric('device','Perangkat terdaftar',d.devices,`${d.onlineDevices} sedang online`)}${metric('signal','Insiden aktif',d.activeIncidents,'Pemantauan real-time','alert')}</section><section class="grid main-grid"><article class="panel"><div class="panel-head"><div><h2>Kondisi operasional</h2><p>Data aktual dari Supabase</p></div></div>${summaryRows()}</article><article class="panel"><div class="panel-head"><div><h2>Aktivitas terbaru</h2><p>Alarm dan kejadian</p></div></div>${recentActivity()}</article></section>`;
  if (state.role === 'rescue') return `${pageHead(r.title,r.subtitle)}<section class="grid rescue-layout"><article class="panel map-panel rescue-map"><div class="panel-head map-head"><div><h2>Peta operasi langsung</h2><p>Gunakan kondisi aktual untuk keputusan lapangan</p></div><span class="tag green">● Terhubung</span></div>${mapView(true)}</article><aside class="panel priority-list"><div class="panel-head"><div><h2>Rekomendasi penanganan</h2><p>${state.incidents.filter(activeIncident).length} kejadian aktif · keputusan akhir oleh komandan</p></div></div>${incidentCards(true)}</aside></section>`;
  return `${pageHead(r.title,r.subtitle)}<section class="grid metrics">${metric('people','Warga terdaftar',d.residents,'Profil kelompok rentan')}${metric('device','JAGA Rumah online',d.onlineDevices,`${d.devices} perangkat terdaftar`)}${metric('signal','SOS aktif',d.activeIncidents,'Perlu validasi petugas','alert')}${metric('check','Warga dinyatakan aman',d.safeResidents,'Berdasarkan pembaruan lapangan')}</section><section class="grid main-grid"><article class="panel map-panel"><div class="panel-head map-head"><div><h2>Peta kesiapan warga</h2><p>Lokasi operasional dibatasi sesuai kewenangan</p></div><button class="link-btn" data-open-section="7">Buka peta →</button></div>${mapView()}</article><aside class="grid"><article class="panel alert-control"><p class="eyebrow">KONTROL PERINGATAN</p><h2>Tingkat ancaman desa</h2><p>Verifikasi kondisi dengan tim lapangan sebelum mengaktifkan peringatan multisensori.</p><div class="level-row"><button data-severity="WASPADA">Waspada</button><button class="active" data-severity="SIAGA">Siaga</button><button data-severity="EVAKUASI">Evakuasi</button></div><button class="btn primary" id="activateAlarm">Tinjau & aktifkan alarm</button></article><article class="panel"><div class="panel-head"><div><h2>Memerlukan tindak lanjut</h2><p>Informasi, bukan keputusan otomatis</p></div><button class="link-btn" data-open-section="3">Lihat semua</button></div><div class="list">${attentionList()}</div></article></aside></section>`;
}

function summaryRows() {
  return `<div class="stat-stack"><div class="mini-stat"><strong>${state.dashboard.onlineDevices}/${state.dashboard.devices}</strong><span>Perangkat online</span></div><div class="mini-stat"><strong>${state.dashboard.activeIncidents}</strong><span>Insiden aktif</span></div><div class="mini-stat"><strong>${state.dashboard.lowBatteryDevices}</strong><span>Baterai di bawah 30%</span></div><div class="mini-stat"><strong>${state.dashboard.alertsSent}</strong><span>Peringatan tercatat</span></div></div>`;
}
function recentActivity() {
  const entries = [...state.incidents.slice(0,3).map(x=>({icon:'signal',text:`${statusLabel(x.status)} · ${x.ownerName}`,time:fmtDate(x.updatedAt)})), ...state.alerts.slice(0,2).map(x=>({icon:'bell',text:`Peringatan ${x.severity} · ${x.target}`,time:fmtDate(x.createdAt)}))].slice(0,5);
  return entries.length ? entries.map(x=>`<div class="activity"><span>${icon(x.icon)}</span><div><p>${esc(x.text)}</p><small>${esc(x.time)}</small></div></div>`).join('') : empty('Belum ada aktivitas');
}
function attentionList() {
  const rows = state.incidents.filter(activeIncident).slice(0,4);
  if (!rows.length) return empty('Tidak ada SOS aktif');
  return rows.map(x=>`<button class="person person-button" data-incident="${esc(x.id)}"><span class="person-avatar">${esc(initials(x.ownerName))}</span><div><b>${esc(x.ownerName)}</b><small>${esc(statusLabel(x.status))} · ${fmtDate(x.createdAt)}</small></div><span class="tag ${riskClass(x.status)}">${esc(statusLabel(x.status))}</span></button>`).join('');
}

function residentRows() {
  if (!state.residents.length) return empty('Belum ada data warga');
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Warga</th><th>Kelompok rentan</th><th>Kebutuhan bantuan</th><th>Kondisi</th></tr></thead><tbody>${state.residents.map(r=>{
    const vulns = (r.vulnerabilities || []).map(v=>v.name).join(', ') || 'Belum diisi';
    const assistance = r.evacuationNotes || r.mobilityNotes || r.communicationNotes || 'Belum diisi';
    return `<tr><td><b>${esc(r.fullName)}</b><small>${r.livesAlone?'Tinggal sendiri':'Memiliki pendamping/keluarga'}</small></td><td>${esc(vulns)}</td><td>${esc(assistance)}</td><td><span class="tag green">Terdaftar</span></td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function residentForm() {
  return `<form class="data-form" id="residentForm"><div class="form-grid"><label>Nama lengkap<input name="fullName" required minlength="3"></label><label>Tanggal lahir<input name="birthDate" type="date"></label><label>Jenis kelamin<select name="gender"><option value="">Tidak diisi</option><option value="LAKI_LAKI">Laki-laki</option><option value="PEREMPUAN">Perempuan</option><option value="LAINNYA">Lainnya</option></select></label><label>Telepon<input name="phone"></label><label class="span-2">Alamat<input name="address"></label><label>Latitude<input name="latitude" type="number" step="any"></label><label>Longitude<input name="longitude" type="number" step="any"></label></div><fieldset><legend>Kelompok rentan</legend><div class="choice-grid">${state.vulnerabilities.map(v=>`<label class="choice"><input type="checkbox" name="vulnerability" value="${esc(v.code)}"><span><b>${esc(v.name)}</b><small>${esc(v.category)}</small></span></label>`).join('')}</div></fieldset><div class="form-grid"><label>Mobilitas<textarea name="mobilityNotes"></textarea></label><label>Komunikasi<textarea name="communicationNotes"></textarea></label><label>Kondisi medis relevan<textarea name="medicalNotes"></textarea></label><label>Kebutuhan evakuasi<textarea name="evacuationNotes"></textarea></label></div><label class="confirm-check"><input type="checkbox" name="livesAlone">Warga tinggal sendiri</label><label class="confirm-check"><input type="checkbox" name="consented" required>Persetujuan pendataan telah diperoleh</label><button class="btn primary form-submit" type="submit">Simpan warga</button></form>`;
}
function renderResidents() { return `${pageHead('Data warga kelompok rentan','Kelola informasi fungsional yang diperlukan saat peringatan dan evakuasi.')}<section class="panel"><div class="toolbar"><label class="search-box">${icon('search')}<input id="residentSearch" placeholder="Cari warga…"></label><button class="btn compact primary" id="toggleResidentForm">+ Tambah warga</button></div><div id="residentFormWrap" hidden>${residentForm()}</div><div id="residentTable">${residentRows()}</div></section>`; }

function renderAlert() { return `${pageHead('Trigger JAGA Rumah','Pilih tingkat peringatan dan target setelah verifikasi kondisi lapangan.')}<section class="section-page"><article class="panel section-main"><div class="alert-target"><span>Target peringatan</span><button class="active" data-target="ALL">Seluruh desa · ${state.devices.length} perangkat</button>${state.devices.map(d=>`<button data-target="${esc(d.id)}">${esc(d.ownerName)} · ${esc(d.id)}</button>`).join('')}</div><div class="alert-control workspace"><p class="eyebrow">KONDISI TERVERIFIKASI PETUGAS</p><h2>Tingkat peringatan</h2><div class="level-row"><button data-severity="WASPADA">Waspada</button><button class="active" data-severity="SIAGA">Siaga</button><button data-severity="EVAKUASI">Evakuasi</button></div><label class="dark-field">Pesan operasional<textarea id="alertMessage" placeholder="Contoh: Segera ikuti pendamping menuju titik aman."></textarea></label><button class="btn primary" id="activateAlarm">Tinjau & aktifkan alarm</button></div><div class="history-list">${alertHistory()}</div></article>${sideSummary()}</section>`; }
function alertHistory() { return state.alerts.length ? state.alerts.slice(0,8).map(a=>`<div class="activity"><span>${icon('bell')}</span><div><p><b>${esc(a.severity)}</b> · ${esc(a.target)}</p><small>${fmtDate(a.createdAt)} · ${esc(a.status)}</small></div></div>`).join('') : empty('Belum ada peringatan'); }

function incidentCards(rescue=false) {
  const rows = state.incidents.filter(activeIncident);
  if (!rows.length) return empty('Tidak ada kejadian aktif');
  return rows.map((x,i)=>{
    const resident = state.residents.find(r=>r.id===x.residentId);
    const needs = resident ? (resident.vulnerabilities||[]).map(v=>v.name).join(', ') : 'Profil kebutuhan belum terhubung';
    return `<article class="priority-card ${i===0?'active':''}" data-incident="${esc(x.id)}"><div class="priority-top"><b><span class="tag ${riskClass(x.status)}">${i+1}</span> &nbsp;${esc(x.ownerName)}</b><span class="distance">${fmtDate(x.createdAt)}</span></div><p>${esc(needs)}${resident?.livesAlone?' · Tinggal sendiri':''}</p><div class="reason-box"><b>Informasi sistem</b><small>${esc(resident?.evacuationNotes || resident?.mobilityNotes || 'Petugas perlu memverifikasi kondisi terbaru.')}</small></div><div class="priority-foot"><span class="tag ${riskClass(x.status)}">${esc(statusLabel(x.status))}</span>${rescue?`<button class="route-btn" data-route="${esc(x.id)}">${icon('route')} Arahkan</button>`:''}</div><div class="status-actions" data-actions="${esc(x.id)}">${statusButtons(x)}</div></article>`;
  }).join('');
}
function statusButtons(incident) {
  const sequence = state.role==='rescue' ? [['ASSIGNED','Terima'],['EN_ROUTE','Berangkat'],['ARRIVED','Tiba'],['EVACUATED','Evakuasi'],['SAFE','Aman'],['CLOSED','Tutup']] : [['ACKNOWLEDGED','Konfirmasi'],['ASSIGNED','Kerahkan'],['SAFE','Aman'],['CLOSED','Tutup']];
  return sequence.map(([value,label])=>`<button class="mini-action" data-status="${value}" data-id="${esc(incident.id)}" ${incident.status===value?'disabled':''}>${label}</button>`).join('');
}
function renderIncidents(title='Status dan penanganan warga') { return `${pageHead(title,'Data sistem membantu penilaian; petugas tetap mengonfirmasi keputusan operasional.')}<section class="section-page"><article class="panel section-main"><div class="filter-row"><button class="filter active" data-filter="active">Aktif</button><button class="filter" data-filter="all">Semua</button></div><div id="incidentList" class="incident-grid">${incidentCards(state.role==='rescue')}</div></article>${sideSummary()}</section>`; }
function renderDevices() { return `${pageHead('Kesehatan JAGA Rumah','Pantau koneksi, baterai, dan waktu komunikasi terakhir perangkat.')}<section class="panel">${state.devices.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Perangkat</th><th>Warga</th><th>Baterai</th><th>Terakhir aktif</th><th>Status</th></tr></thead><tbody>${state.devices.map(d=>`<tr><td><b>${esc(d.id)}</b><small>${esc(d.status)}</small></td><td>${esc(d.ownerName)}</td><td>${d.battery}%</td><td>${fmtDate(d.lastSeenAt)}</td><td><span class="tag ${d.online?'green':'red'}">${d.online?'Online':'Offline'}</span></td></tr>`).join('')}</tbody></table></div>`:empty('Belum ada perangkat')}</section>`; }
function renderMap(title='Peta warga') { return `${pageHead(title,'Informasi lokasi digunakan sesuai kewenangan dan kebutuhan operasi.')}<section class="section-page"><article class="panel map-panel section-main"><div class="panel-head map-head"><div><h2>Cakupan langsung</h2><p>${state.residents.length} warga terdaftar</p></div><span class="tag green">● Terhubung</span></div>${mapView(state.role==='rescue')}</article>${sideSummary()}</section>`; }
function renderGeneric(label) {
  if (/Riwayat|Laporan/.test(label)) return `${pageHead(label,'Ringkasan kejadian, alarm, dan perubahan status yang tersimpan.')}<section class="panel">${recentActivity()}</section>`;
  if (/Monitoring/.test(label)) return renderMap(label);
  if (/Data penerima/.test(label)) return renderResidents();
  if (/Feed bantuan|Update status|Kerahkan/.test(label)) return renderIncidents(label);
  if (/Navigasi|Jejak|Koordinasi/.test(label)) return renderMap(label);
  return `${pageHead(label,'Modul ini menggunakan data dan kewenangan yang sama dari pusat JAGA.')}<section class="panel">${summaryRows()}</section>`;
}
function sideSummary() { return `<aside class="panel section-side"><div class="panel-head"><div><h2>Ringkasan</h2><p>Kondisi terkini</p></div></div><div class="stat-stack"><div class="mini-stat"><strong>${state.dashboard.residents}</strong><span>Warga terdaftar</span></div><div class="mini-stat"><strong>${state.dashboard.onlineDevices}/${state.dashboard.devices}</strong><span>Perangkat online</span></div><div class="mini-stat"><strong>${state.dashboard.activeIncidents}</strong><span>Kejadian aktif</span></div></div></aside>`; }

function render() {
  const content = $('#content');
  if (state.loading) content.innerHTML = loading();
  else if (state.error) content.innerHTML = failure();
  else {
    const label = roleConfig[state.role].nav[state.section]?.[1];
    if (state.section===0) content.innerHTML = renderDashboard();
    else if (state.role==='desa' && label==='Data warga') content.innerHTML = renderResidents();
    else if (state.role==='desa' && label==='Trigger alarm') content.innerHTML = renderAlert();
    else if (state.role==='desa' && ['Status warga','Kerahkan Rescue','Riwayat kejadian'].includes(label)) content.innerHTML = renderIncidents(label);
    else if (state.role==='desa' && label==='Kesehatan device') content.innerHTML = renderDevices();
    else if (label?.includes('Peta') || label?.includes('Navigasi') || label?.includes('Jejak') || label?.includes('Koordinasi') || label==='Monitoring desa') content.innerHTML = renderMap(label);
    else if (state.role==='rescue' && ['Feed bantuan','Update status warga'].includes(label)) content.innerHTML = renderIncidents(label);
    else content.innerHTML = renderGeneric(label);
  }
  bindContent();
}

function renderNavigation() {
  const config = roleConfig[state.role];
  $('#roleName').textContent = config.name;
  document.querySelectorAll('[data-role]').forEach(x=>x.classList.toggle('selected',x.dataset.role===state.role));
  $('#mainNav').innerHTML = config.nav.map((item,i)=>`<button class="nav-item ${i===state.section?'active':''}" data-section="${i}">${icon(item[0])}<span>${esc(item[1])}</span></button>`).join('');
  const mobile = config.nav.slice(0,5);
  $('#mobileNav').innerHTML = mobile.map((item,i)=>`<button class="${i===state.section?'active':''}" data-section="${i}">${icon(item[0])}<span>${esc(item[1].split(' ')[0])}</span></button>`).join('');
  document.querySelectorAll('[data-section]').forEach(button=>button.onclick=()=>{state.section=Number(button.dataset.section);renderNavigation();render();closeSidebar();});
}

async function loadData(silent=false) {
  if (!silent) { state.loading=true; state.error=''; render(); }
  try {
    const [dashboard,residents,devices,incidents,alerts,vulnerabilities] = await Promise.all([JagaApi.dashboard(),JagaApi.residents(),JagaApi.devices(),JagaApi.incidents(),JagaApi.alerts(),JagaApi.vulnerabilityTypes()]);
    Object.assign(state,{dashboard:dashboard.data,residents:residents.data,devices:devices.data,incidents:incidents.data,alerts:alerts.data,vulnerabilities:vulnerabilities.data,loading:false,error:''});
    $('#networkStatus').textContent='Pusat data aktif'; $('#networkCount').textContent=`${state.dashboard.onlineDevices}/${state.dashboard.devices} perangkat`; $('#notificationCount').textContent=String(state.dashboard.activeIncidents);
  } catch (error) { state.loading=false; state.error=error.message; $('#networkStatus').textContent='Koneksi bermasalah'; }
  render();
}

function bindContent() {
  $('#retryLoad')?.addEventListener('click',()=>loadData());
  document.querySelectorAll('[data-open-section]').forEach(b=>b.onclick=()=>{state.section=Number(b.dataset.openSection);renderNavigation();render();});
  document.querySelectorAll('[data-severity]').forEach(b=>b.onclick=()=>{state.alarm.severity=b.dataset.severity;document.querySelectorAll('[data-severity]').forEach(x=>x.classList.toggle('active',x===b));});
  document.querySelectorAll('[data-target]').forEach(b=>b.onclick=()=>{state.alarm.target=b.dataset.target;document.querySelectorAll('[data-target]').forEach(x=>x.classList.toggle('active',x===b));});
  $('#activateAlarm')?.addEventListener('click',openAlarmModal);
  $('#toggleResidentForm')?.addEventListener('click',()=>{const wrap=$('#residentFormWrap');wrap.hidden=!wrap.hidden;});
  $('#residentForm')?.addEventListener('submit',submitResident);
  $('#residentSearch')?.addEventListener('input',event=>{const q=event.target.value.toLowerCase();document.querySelectorAll('#residentTable tbody tr').forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(q));});
  document.querySelectorAll('[data-status]').forEach(button=>button.onclick=async event=>{event.stopPropagation();await changeStatus(button.dataset.id,button.dataset.status,button);});
  document.querySelectorAll('[data-route]').forEach(button=>button.onclick=event=>{event.stopPropagation();showToast('Rute operasi dibuka berdasarkan lokasi kejadian');});
  document.querySelectorAll('.filter').forEach(button=>button.onclick=()=>{document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x===button));$('#incidentList').innerHTML=button.dataset.filter==='all'?allIncidentCards():incidentCards(state.role==='rescue');bindContent();});
}
function allIncidentCards() { const original=state.incidents; if(!original.length)return empty('Belum ada kejadian'); return original.map((x,i)=>`<article class="priority-card"><div class="priority-top"><b>${esc(x.ownerName)}</b><span>${fmtDate(x.createdAt)}</span></div><p>${esc(statusLabel(x.status))}</p><div class="priority-foot"><span class="tag ${riskClass(x.status)}">${esc(statusLabel(x.status))}</span></div></article>`).join(''); }
async function submitResident(event) {
  event.preventDefault(); const form=event.currentTarget, button=form.querySelector('button[type=submit]'); button.disabled=true; button.textContent='Menyimpan…';
  const data=new FormData(form); const payload=Object.fromEntries(data.entries()); payload.livesAlone=data.has('livesAlone'); payload.consented=data.has('consented'); payload.vulnerabilityCodes=data.getAll('vulnerability');
  try { await JagaApi.createResident(payload); showToast('Data warga berhasil disimpan'); form.reset(); await loadData(true); }
  catch(error){showToast(`Gagal menyimpan: ${error.message}`);} finally {button.disabled=false;button.textContent='Simpan warga';}
}
async function changeStatus(id,status,button) { button.disabled=true; try{await JagaApi.updateIncident(id,status);showToast(`Status diperbarui: ${statusLabel(status)}`);await loadData(true);}catch(error){showToast(`Gagal: ${error.message}`);}finally{button.disabled=false;} }

const modal=$('#modal'), confirmCheck=$('#confirmCheck');
function openAlarmModal(){state.alarm.message=$('#alertMessage')?.value||'';$('#modalTitle').textContent=`Aktifkan peringatan ${state.alarm.severity}?`;$('#modalDescription').innerHTML=`Peringatan akan dikirim ke <b>${state.alarm.target==='ALL'?'seluruh JAGA Rumah':esc(state.alarm.target)}</b>.`;modal.classList.add('open');confirmCheck.checked=false;$('#modalConfirm').disabled=true;}
function closeModal(){modal.classList.remove('open');}
confirmCheck.onchange=()=>$('#modalConfirm').disabled=!confirmCheck.checked;
$('#modalClose').onclick=closeModal; $('#modalCancel').onclick=closeModal;
$('#modalConfirm').onclick=async()=>{const button=$('#modalConfirm');button.disabled=true;button.textContent='Mengirim…';try{const result=await JagaApi.sendVillageAlert(state.alarm.severity,state.alarm.target,state.alarm.message);closeModal();showToast(`Peringatan dikirim ke ${result.targetedDevices} perangkat`);await loadData(true);}catch(error){showToast(`Gagal mengirim: ${error.message}`);}finally{button.textContent='Aktifkan alarm';button.disabled=!confirmCheck.checked;}};
function showToast(message){const toast=$('#toast');toast.querySelector('span').textContent=message;toast.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.classList.remove('show'),3500);}
function closeSidebar(){ $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); }

$('#roleButton').onclick=()=>$('#roleMenu').classList.toggle('open');
document.querySelectorAll('[data-role]').forEach(button=>button.onclick=()=>{state.role=button.dataset.role;state.section=0;JagaApi.setRole(state.role);history.replaceState({},'',`?role=${state.role}`);$('#roleMenu').classList.remove('open');renderNavigation();render();});
$('#menuButton').onclick=()=>{$('#sidebar').classList.add('open');$('#scrim').classList.add('show');}; $('#scrim').onclick=closeSidebar;
document.addEventListener('click',event=>{if(!event.target.closest('.role-switcher'))$('#roleMenu').classList.remove('open');});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeSidebar();closeModal();}});
window.addEventListener('resize',closeSidebar);

JagaApi.setRole(state.role); renderNavigation(); loadData();
JagaApi.createEventStream((type,data)=>{const messages={'sos.created':`SOS diterima dari ${data.ownerName}`,'incident.updated':`Status ${data.ownerName}: ${statusLabel(data.status)}`,'alert.created':`Peringatan ${data.severity} tercatat`,'resident.created':'Data warga baru ditambahkan'};showToast(messages[type]||'Data diperbarui');loadData(true);});
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/service-worker.js'));
