'use strict';
/* ==========================================================================
   JAGA — aplikasi dashboard (JAGA Pusat, JAGA Desa, JAGA Rescue)
   Satu berkas, tanpa framework. Bagian: utilitas, konfigurasi role, komponen,
   tampilan per role, peta, modal, aksi, pemuatan data, dan boot.
   ========================================================================== */

/* ------------------------------------------------------------- Utilitas */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const icon = name => `<svg class="i"><use href="#i-${name}"/></svg>`;
const initials = name => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
const num = value => (value === null || value === undefined || value === '' ? null : (Number.isFinite(Number(value)) ? Number(value) : null));

const dateTime = value => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(date) : '—';
};
const timeAgo = value => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} mnt lalu`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.round(hours / 24)} hari lalu`;
};

const STATUS = {
  NEW: ['SOS baru', 'red'], ACKNOWLEDGED: ['Dikonfirmasi', 'orange'], ASSIGNED: ['Tim ditugaskan', 'blue'],
  EN_ROUTE: ['Menuju lokasi', 'blue'], ARRIVED: ['Tiba di lokasi', 'blue'], EVACUATED: ['Dievakuasi', 'green'],
  SAFE: ['Aman', 'green'], CANCELLED: ['Dibatalkan', 'gray'], CLOSED: ['Selesai', 'gray']
};
const SEVERITY = { WASPADA: ['Waspada', 'yellow'], SIAGA: ['Siaga', 'orange'], EVAKUASI: ['Evakuasi', 'red'] };
const ABILITY = {
  MANDIRI: ['Dapat mengungsi sendiri', 'green'], PERLU_BANTUAN: ['Perlu bantuan', 'orange'], TIDAK_BISA_SENDIRI: ['Tidak bisa mengungsi sendiri', 'red']
};
const PRIO_RANK = { red: 0, orange: 1, yellow: 2, green: 3 };
const PRIO_NAME = { red: 'Merah', orange: 'Oranye', yellow: 'Kuning', green: 'Hijau' };
const TEAM_STATUS = { AVAILABLE: 'Tersedia', ASSIGNED: 'Ditugaskan', EN_ROUTE: 'Menuju lokasi', ON_SCENE: 'Di lokasi', OFF_DUTY: 'Tidak bertugas' };
const ORG_TYPES = { BPBD: 'BPBD', BASARNAS: 'Basarnas/SAR', DAMKAR: 'Pemadam kebakaran', POLISI: 'Polisi', TNI: 'TNI', RELAWAN: 'Relawan', LAYANAN_KESEHATAN: 'Layanan kesehatan', LAINNYA: 'Lainnya' };
const DEFAULT_MESSAGE = {
  WASPADA: 'Waspada: tetap siaga dan ikuti informasi dari petugas desa.',
  SIAGA: 'Siaga: bersiap mengungsi dan hubungi pendamping Anda.',
  EVAKUASI: 'Evakuasi: segera menuju titik aman bersama pendamping.'
};

const isActive = incident => !['SAFE', 'CANCELLED', 'CLOSED'].includes(incident.status);
const statusBadge = status => { const [label, tone] = STATUS[status] || [status || '—', 'gray']; return badge(label, tone); };
const severityBadge = severity => { const [label, tone] = SEVERITY[severity] || [severity || '—', 'gray']; return badge(label, tone); };

/* ----------------------------------------------------- Konfigurasi role */
const ROLES = {
  // nav: 'sidebar' = menu halaman di sisi kiri; 'tabs' = tab di bawah navbar atas.
  pusat: {
    label: 'JAGA Pusat', home: 'ringkasan', nav: 'sidebar',
    pages: [['ringkasan', 'Ringkasan', 'home'], ['desa', 'Monitoring desa', 'building'], ['warga', 'Data warga', 'users'],
      ['aturan', 'Aturan prioritas', 'sliders'], ['akun', 'Akun & akses', 'shield'], ['laporan', 'Laporan', 'file'], ['audit', 'Log audit', 'list']]
  },
  desa: {
    label: 'JAGA Desa', home: 'beranda', nav: 'sidebar',
    pages: [['beranda', 'Beranda', 'home'], ['warga', 'Warga', 'users'], ['alarm', 'Alarm & operasi', 'bell'],
      ['kalung', 'Kalung', 'device'], ['kejadian', 'Kejadian', 'alert'], ['peta', 'Peta', 'map']]
  },
  rescue: {
    label: 'JAGA Rescue', home: 'prioritas', nav: 'sidebar',
    pages: [['prioritas', 'Prioritas', 'activity'], ['operasi', 'Operasi', 'signal'], ['tugas', 'Tugas lapangan', 'route'],
      ['tim', 'Tim', 'truck'], ['peta', 'Peta', 'map']]
  }
};

/* --------------------------------------------------------------- State */
const state = {
  role: 'desa', session: null, demo: false, loading: true, error: '', pendingRender: false, maps: [],
  data: {
    overview: null, safety: null, map: null, villages: [], hamlets: [], vulnTypes: [], incidents: [], alerts: [], notifications: [],
    operations: [], residents: [], devices: [], teams: [], rosters: {}, accounts: [], ruleSets: [], activeRules: null, thresholds: [], audit: [], opsAll: []
  },
  ui: {
    menu: null, modal: null, residentSearch: '', residentFilter: 'all', incidentFilter: 'active', auditSearch: '',
    alarm: { severity: 'SIAGA', target: 'ALL', message: '', hamletIds: [], waterLevelCm: '', note: '' }
  }
};
const D = state.data;

const ownVillageId = () => state.session?.villageIds?.[0] || D.villages[0]?.id || '';
const villageName = id => D.villages.find(v => v.id === id)?.name || '—';
const hamletName = id => D.hamlets.find(h => h.id === id)?.name || '—';
const rosterRows = () => Object.values(D.rosters).flat().map(r => ({ ...r, id: r.residentId }));
const sortedByPriority = rows => rows.slice().sort((a, b) =>
  (PRIO_RANK[a.priority?.color] ?? 9) - (PRIO_RANK[b.priority?.color] ?? 9) || (b.priority?.score || 0) - (a.priority?.score || 0));

/* ------------------------------------------------------------ Komponen */
function badge(text, tone = 'gray', plain = false) { return `<span class="badge ${tone}${plain ? ' plain' : ''}">${esc(text)}</span>`; }

function pageHead(title, sub = '', actions = '') {
  return `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
}
function kpi({ icon: name, label, value, hint = '', tone = '' }) {
  return `<article class="kpi ${tone}"><div class="kpi-top"><span class="kpi-icon">${icon(name)}</span>${esc(label)}</div><strong>${esc(value)}</strong><small>${esc(hint)}</small></article>`;
}
function card({ title, sub = '', actions = '', body, flush = false, extra = '' }) {
  return `<section class="card ${extra}"><div class="card-head"><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${actions}</div><div class="card-body ${flush ? 'flush' : ''}">${body}</div></section>`;
}
function empty(title, hint = '', name = 'check') {
  return `<div class="empty"><span class="empty-icon">${icon(name)}</span><b>${esc(title)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</div>`;
}
function callout({ tone = '', icon: name = 'info', title, text = '', actions = '' }) {
  return `<div class="callout ${tone}"><span class="callout-icon">${icon(name)}</span><div><b>${esc(title)}</b>${text ? `<p>${esc(text)}</p>` : ''}</div>${actions ? `<div class="callout-actions">${actions}</div>` : ''}</div>`;
}
function tableWrap(head, rows) {
  return `<div class="table-wrap"><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
function batteryCell(level) {
  const value = num(level);
  if (value === null) return '<span class="battery">—</span>';
  const tone = value <= 20 ? 'low' : value <= 40 ? 'mid' : '';
  return `<span class="battery"><span class="meter ${tone}"><i style="width:${Math.max(4, Math.min(100, value))}%"></i></span>${value}%</span>`;
}
function groupChips(vulnerabilities = []) {
  if (!vulnerabilities.length) return '<small>Belum diisi</small>';
  return `<div class="chips">${vulnerabilities.map(v => badge(v.name || v.category || '—', 'gray', true)).join('')}</div>`;
}
function abilityBadge(value) {
  const entry = ABILITY[value];
  return entry ? badge(entry[0], entry[1]) : badge('Belum dinilai', 'gray', true);
}
function prioBadge(priority) {
  return priority ? `<span class="badge ${priority.color}">${esc(priority.label)}</span>` : badge('Belum dinilai', 'gray', true);
}
const topReasons = (row, n = 3) => (row.priority?.reasons || []).slice().sort((a, b) => b.delta - a.delta).slice(0, n).map(x => x.explanation).join(' · ');

/* ---------------------------------------------------------- Tampilan: Pusat */
function villageStats() {
  const map = D.map || { villages: [], devices: [], incidents: [] };
  return (D.villages.length ? D.villages : map.villages).map(village => {
    const residents = D.residents.filter(r => r.villageId === village.id);
    const devices = map.devices.filter(d => d.villageId === village.id && d.status !== 'STOCK');
    const online = devices.filter(d => d.online).length;
    const lastSeen = devices.map(d => d.lastSeenAt).filter(Boolean).sort().pop() || null;
    return {
      village, residents: residents.length, devices: devices.length, online,
      lowBattery: devices.filter(d => num(d.battery) !== null && d.battery <= 20).length,
      lastSeen,
      incidents: map.incidents.filter(i => i.villageId === village.id).length,
      operation: D.operations.find(o => o.villageId === village.id) || null
    };
  });
}

function viewPusatRingkasan() {
  const c = D.overview?.counters || {};
  const ops = D.operations;
  const banner = ops.length
    ? callout({ tone: 'red', icon: 'signal', title: `${ops.length} operasi sedang berjalan`, text: 'JAGA Rescue memiliki akses ke data pemakai kalung di area terdampak selama operasi berlangsung.', actions: `<a class="btn outline sm" href="#/desa">Lihat desa</a>` })
    : callout({ tone: 'blue', icon: 'shield', title: 'Tidak ada operasi aktif', text: 'Seluruh wilayah dalam kondisi pemantauan normal.' });
  const attention = D.overview?.attention || {};
  const activity = [
    ...D.incidents.slice(0, 5).map(i => ({ name: 'alert', tone: 'red', text: `${i.ownerName || 'Warga'} · ${(STATUS[i.status] || [i.status])[0]}`, time: i.updatedAt || i.createdAt })),
    ...D.alerts.slice(0, 5).map(a => ({ name: 'bell', tone: 'orange', text: `Peringatan ${(SEVERITY[a.severity] || [a.severity])[0]} · ${a.target}`, time: a.createdAt }))
  ].sort((a, b) => String(b.time).localeCompare(String(a.time))).slice(0, 6);
  return `${pageHead('Ringkasan nasional', 'Pemantauan kesiapan dan respons seluruh wilayah dalam satu tampilan.')}
    <div class="stack">${banner}
    <div class="kpis">
      ${kpi({ icon: 'building', label: 'Desa', value: c.villages ?? 0, hint: `${c.hazardZones ?? 0} zona bahaya aktif` })}
      ${kpi({ icon: 'users', label: 'Warga', value: c.residents ?? 0, hint: `${c.vulnerableResidents ?? 0} kelompok rentan` })}
      ${kpi({ icon: 'device', label: 'Kalung online', value: `${c.devicesOnline ?? 0}/${c.devicesTotal ?? 0}`, hint: `${c.devicesLowBattery ?? 0} baterai rendah`, tone: 'blue' })}
      ${kpi({ icon: 'alert', label: 'Insiden aktif', value: c.activeIncidents ?? 0, hint: `${c.criticalIncidents ?? 0} tingkat evakuasi`, tone: (c.activeIncidents ?? 0) > 0 ? 'red' : '' })}
      ${kpi({ icon: 'signal', label: 'Operasi aktif', value: ops.length, hint: 'Akses Rescue terbuka', tone: ops.length ? 'orange' : '' })}
      ${kpi({ icon: 'truck', label: 'Tim tersedia', value: `${c.teamsAvailable ?? 0}/${c.teamsTotal ?? 0}`, hint: `${c.teamsBusy ?? 0} sedang bertugas` })}
    </div>
    <div class="grid two">
      ${card({ title: 'Operasi aktif', sub: 'Desa dengan alarm Siaga atau Evakuasi', flush: true, body: ops.length ? operationsTable(ops) : empty('Belum ada operasi aktif', 'Operasi dibuka JAGA Desa saat alarm Siaga/Evakuasi dibunyikan.', 'shield') })}
      ${card({ title: 'Perlu perhatian', sub: 'Kondisi perangkat dan kejadian lama', flush: true, body: `<div class="list">
        ${(attention.offlineDevices || []).slice(0, 4).map(d => attentionRow('red', 'device', `Kalung ${d.id} offline`, `Sinyal terakhir ${timeAgo(d.lastSeenAt)}`)).join('')}
        ${(attention.lowBattery || []).slice(0, 4).map(d => attentionRow('orange', 'battery', `Kalung ${d.id} baterai ${d.battery}%`, d.resident ? `Milik ${d.resident}` : 'Segera ganti baterai')).join('')}
        ${(attention.oldestOpenIncidents || []).slice(0, 3).map(i => attentionRow('red', 'alert', `${i.owner || 'Warga'} · ${(STATUS[i.status] || [i.status])[0]}`, `Dilaporkan ${timeAgo(i.createdAt)}`)).join('')}
        ${!(attention.offlineDevices || []).length && !(attention.lowBattery || []).length && !(attention.oldestOpenIncidents || []).length ? empty('Semua normal', 'Tidak ada yang perlu ditindaklanjuti.') : ''}
      </div>` })}
    </div>
    ${card({ title: 'Aktivitas terbaru', flush: true, body: activity.length ? `<div class="list">${activity.map(a => attentionRow(a.tone, a.name, a.text, timeAgo(a.time))).join('')}</div>` : empty('Belum ada aktivitas') })}
    </div>`;
}
function attentionRow(tone, name, title, sub) {
  return `<div class="row-item"><span class="row-icon ${tone}">${icon(name)}</span><div class="grow"><b>${esc(title)}</b><small>${esc(sub)}</small></div></div>`;
}
function operationsTable(ops) {
  return tableWrap(['Desa', 'Tingkat', 'Area', 'Tinggi air', 'Dibuka'], ops.map(op => `<tr>
    <td><b>${esc(op.villageName || villageName(op.villageId))}</b><small>${esc(op.disasterType)}</small></td>
    <td>${severityBadge(op.severity)}</td><td>${esc(op.areaLabel)}</td>
    <td>${op.waterLevelCm != null ? `${op.waterLevelCm} cm` : '<small>Belum dilaporkan</small>'}</td>
    <td>${esc(timeAgo(op.openedAt))}<small>${esc(dateTime(op.openedAt))}</small></td></tr>`));
}

function viewPusatDesa() {
  const rows = villageStats();
  const body = rows.length ? tableWrap(['Desa', 'Warga', 'Kalung online', 'Baterai rendah', 'Sinyal terakhir', 'Kejadian', 'Status'], rows.map(s => {
    const status = s.operation ? badge('Operasi aktif', 'red') : s.devices && s.online < s.devices ? badge('Perlu perhatian', 'orange') : badge('Normal', 'green');
    return `<tr><td><b>${esc(s.village.name)}</b><small>${s.village.population ? `${s.village.population.toLocaleString('id-ID')} jiwa` : 'Penduduk belum diisi'}</small></td>
      <td>${s.residents}</td><td>${s.online}/${s.devices}</td><td>${s.lowBattery ? badge(`${s.lowBattery} kalung`, 'orange') : '—'}</td>
      <td>${esc(timeAgo(s.lastSeen))}</td><td>${s.incidents ? badge(`${s.incidents} aktif`, 'red') : '—'}</td><td>${status}</td></tr>`;
  })) : empty('Belum ada desa', '', 'building');
  return `${pageHead('Monitoring desa', 'Status setiap desa: warga terdaftar, kondisi kalung, dan operasi yang sedang berjalan.')}
    <div class="stack">${card({ title: 'Seluruh desa', sub: `${rows.length} desa dalam cakupan`, flush: true, body })}
    ${card({ title: 'Peta wilayah', sub: 'Titik warga, zona bahaya, titik kumpul, dan tim', flush: true, extra: 'has-legend', body: `<div class="map-box" data-map="overview"></div>${mapLegend('overview')}` })}</div>`;
}

function residentFilterFn(row) {
  const f = state.ui.residentFilter, cats = row.vulnerabilityCategories || [];
  if (f === 'DISABILITAS' || f === 'LANSIA' || f === 'IBU_HAMIL') return cats.includes(f);
  if (f === 'LAINNYA') return !cats.some(c => ['DISABILITAS', 'LANSIA', 'IBU_HAMIL'].includes(c));
  return true;
}
function residentsView({ canAdd, withVillage }) {
  const term = state.ui.residentSearch.trim().toLowerCase();
  const rows = D.residents.filter(residentFilterFn)
    .filter(r => !term || [r.fullName, r.phone, r.address, ...(r.vulnerabilities || []).map(v => v.name)].some(x => String(x ?? '').toLowerCase().includes(term)));
  const filters = [['all', 'Semua'], ['DISABILITAS', 'Disabilitas'], ['LANSIA', 'Lansia'], ['IBU_HAMIL', 'Ibu hamil'], ['LAINNYA', 'Lainnya']];
  const head = ['Warga', ...(withVillage ? ['Desa'] : []), 'Dusun', 'Kelompok rentan', 'Kemampuan evakuasi', 'Kalung'];
  const body = rows.length ? tableWrap(head, rows.map(r => `<tr>
      <td><div class="cell-flex"><span class="avatar-sm">${esc(initials(r.fullName))}</span><div><b>${esc(r.fullName)}</b><small>${r.age != null ? `${r.age} th` : 'Usia —'} · ${r.livesAlone ? 'tinggal sendiri' : 'bersama keluarga'}</small></div></div></td>
      ${withVillage ? `<td>${esc(villageName(r.villageId))}</td>` : ''}
      <td>${esc(r.hamletId ? hamletName(r.hamletId) : '—')}</td>
      <td>${groupChips(r.vulnerabilities)}</td>
      <td>${abilityBadge(r.evacuationAbility)}${r.timeCriticalMedical ? `<small><b>Medis mendesak</b></small>` : ''}</td>
      <td>${r.deviceId ? badge(r.deviceId, 'green', true) : badge('Belum berkalung', 'gray', true)}</td></tr>`)) : empty('Tidak ada warga yang cocok', 'Ubah kata kunci atau filter kelompok.', 'users');
  return `${pageHead(canAdd ? 'Data warga' : 'Data warga terdaftar', canAdd ? 'Warga kelompok rentan yang berkalung JAGA. Data ini menentukan prioritas saat bencana.' : 'Pandangan baca saja seluruh wilayah. Pembaruan data dilakukan oleh JAGA Desa.',
      canAdd ? `<button class="btn primary" data-action="open-modal" data-modal="resident">${icon('plus')} Tambah warga</button>` : '')}
    ${card({ title: `${rows.length} warga`, sub: `Dari ${D.residents.length} warga terdaftar`, flush: true, body: `
      <div class="toolbar"><label class="search">${icon('search')}<input type="search" placeholder="Cari nama, telepon, atau kelompok…" value="${esc(state.ui.residentSearch)}" data-bind="residentSearch" data-keep-focus="1"></label>
      <div class="segmented">${filters.map(([v, l]) => `<button class="${state.ui.residentFilter === v ? 'active' : ''}" data-action="resident-filter" data-value="${v}">${l}</button>`).join('')}</div></div>${body}` })}`;
}

const FACTOR_LABEL = {
  has_active_sos: 'SOS aktif', flood_depth_cm: 'Tinggi air di rumah (cm)', hazard_zone_risk: 'Risiko zona bahaya', operation_water_level_cm: 'Tinggi air umum dari Desa (cm)',
  evacuation_ability: 'Kemampuan evakuasi', lives_alone: 'Tinggal sendiri', time_critical_medical: 'Kebutuhan medis mendesak', vulnerability_codes: 'Jenis kerentanan',
  is_pregnant: 'Hamil', age_group: 'Kelompok usia', vulnerability_severity: 'Tingkat kerentanan', device_online: 'Kalung terhubung', terrain_isolation: 'Kesulitan akses desa',
  is_night: 'Malam hari', has_contact: 'Punya kontak darurat'
};
function viewPusatAturan() {
  const set = D.activeRules;
  if (!set) return `${pageHead('Aturan prioritas', 'Dasar penentuan urutan penyelamatan.')}${card({ title: 'Belum ada aturan aktif', body: empty('Belum ada rule set berstatus aktif', 'Publikasikan satu rule set agar prioritas dapat dihitung.', 'sliders') })}`;
  const dummy = /dummy/i.test(set.name);
  const levelTone = { PANTAU: 'green', SEGERA_TINJAU: 'yellow', RESPONS_CEPAT: 'orange', DARURAT: 'red' };
  const levelName = { PANTAU: 'Hijau · Pantau', SEGERA_TINJAU: 'Kuning · Segera ditinjau', RESPONS_CEPAT: 'Oranye · Respons cepat', DARURAT: 'Merah · Darurat' };
  const thresholds = D.thresholds.slice().sort((a, b) => a.minScore - b.minScore);
  const rules = (set.rules || []).slice().sort((a, b) => a.displayOrder - b.displayOrder);
  return `${pageHead('Aturan prioritas penyelamatan', 'Aturan yang menentukan warna prioritas di tampilan JAGA Rescue. Setiap warna selalu disertai alasannya.')}
    <div class="stack">
    ${dummy ? callout({ tone: 'yellow', icon: 'alert', title: 'Bobot ini contoh untuk demo', text: 'Sebelum dipakai di operasi nyata, bobot harus ditinjau dan disahkan JAGA Pusat bersama BPBD, Dinas Sosial, tenaga kesehatan, dan organisasi penyandang disabilitas setempat.' }) : ''}
    <div class="grid two-even">
      ${card({ title: set.name, sub: `Versi ${set.version} · ${set.ruleCount ?? rules.length} aturan`, actions: badge(set.status === 'ACTIVE' ? 'Aktif' : set.status, set.status === 'ACTIVE' ? 'green' : 'gray'), body: `<p>${esc(set.description || '')}</p>` })}
      ${card({ title: 'Ambang warna', sub: 'Skor total warga menentukan warna', body: thresholds.length ? `<div class="list">${thresholds.map(t => `<div class="row-item" style="padding-left:0;padding-right:0"><span class="dot ${levelTone[t.level]}"></span><div class="grow"><b>${esc(levelName[t.level] || t.level)}</b></div><b>${t.minScore} ke atas</b></div>`).join('')}</div>` : empty('Ambang belum diatur') })}
    </div>
    ${card({ title: 'Daftar aturan', sub: 'Poin ditambahkan bila kondisi terpenuhi', flush: true, body: tableWrap(['Faktor', 'Poin', 'Penjelasan'], rules.map(r => `<tr><td><b>${esc(FACTOR_LABEL[r.factorKey] || r.factorKey)}</b><small>${esc(r.factorKey)} · ${esc(r.operator)} ${esc(Array.isArray(r.comparisonValue) ? r.comparisonValue.join(', ') : r.comparisonValue ?? '')}</small></td><td>${badge(`${r.scoreDelta > 0 ? '+' : ''}${r.scoreDelta}`, r.scoreDelta >= 25 ? 'red' : r.scoreDelta >= 10 ? 'orange' : 'gray', true)}</td><td>${esc(r.explanation)}</td></tr>`)) })}
    </div>`;
}

function viewPusatAkun() {
  const body = D.accounts.length ? tableWrap(['Pengguna', 'Peran', 'Wilayah', 'Status', 'Login terakhir'], D.accounts.map(a => `<tr>
    <td><div class="cell-flex"><span class="avatar-sm">${esc(initials(a.displayName))}</span><div><b>${esc(a.displayName)}</b><small>${esc(a.email)}</small></div></div></td>
    <td>${badge({ PUSAT: 'JAGA Pusat', DESA: 'JAGA Desa', RESCUE: 'JAGA Rescue' }[a.role] || a.role, a.role === 'PUSAT' ? 'blue' : a.role === 'DESA' ? 'green' : 'orange')}<small>${esc(a.title || '')}</small></td>
    <td>${a.role === 'PUSAT' || !a.villageIds ? 'Seluruh wilayah' : esc((a.villageIds || []).map(villageName).join(', ') || '—')}</td>
    <td>${badge(a.active ? 'Aktif' : 'Nonaktif', a.active ? 'green' : 'gray')}</td><td>${esc(a.lastLoginAt ? timeAgo(a.lastLoginAt) : 'Belum pernah')}</td></tr>`)) : empty('Belum ada akun', '', 'shield');
  return `${pageHead('Akun & akses', 'Akun JAGA Desa dan JAGA Rescue dibuat oleh JAGA Pusat dan dibatasi pada wilayahnya.',
    `<button class="btn primary" data-action="open-modal" data-modal="account">${icon('plus')} Buat akun</button>`)}
    ${card({ title: `${D.accounts.length} akun`, flush: true, body })}`;
}

function viewPusatLaporan() {
  const ops = D.opsAll;
  const opsBody = ops.length ? tableWrap(['Desa', 'Jenis', 'Tingkat', 'Area', 'Tinggi air', 'Dibuka', 'Ditutup'], ops.map(o => `<tr>
    <td><b>${esc(o.villageName || villageName(o.villageId))}</b></td><td>${esc(o.disasterType)}</td><td>${severityBadge(o.severity)}</td><td>${esc(o.areaLabel)}</td>
    <td>${o.waterLevelCm != null ? `${o.waterLevelCm} cm` : '—'}</td><td>${esc(dateTime(o.openedAt))}</td><td>${o.closedAt ? esc(dateTime(o.closedAt)) : badge('Berjalan', 'red')}</td></tr>`)) : empty('Belum ada riwayat operasi', '', 'file');
  const incBody = D.incidents.length ? tableWrap(['Warga', 'Desa', 'Jenis', 'Status', 'Dilaporkan'], D.incidents.map(i => `<tr>
    <td><b>${esc(i.ownerName || '—')}</b></td><td>${esc(villageName(i.villageId))}</td><td>${esc(i.disasterType || '—')}</td><td>${statusBadge(i.status)}</td><td>${esc(dateTime(i.createdAt))}</td></tr>`)) : empty('Belum ada kejadian', '', 'file');
  return `${pageHead('Laporan', 'Rekap operasi dan kejadian untuk evaluasi dan pelaporan kebijakan.')}
    <div class="stack">
    ${card({ title: 'Riwayat operasi', sub: `${ops.length} operasi`, actions: `<button class="btn outline sm" data-action="export-csv" data-kind="operations">${icon('download')} Unduh CSV</button>`, flush: true, body: opsBody })}
    ${card({ title: 'Riwayat kejadian', sub: `${D.incidents.length} kejadian`, actions: `<button class="btn outline sm" data-action="export-csv" data-kind="incidents">${icon('download')} Unduh CSV</button>`, flush: true, body: incBody })}
    </div>`;
}

function viewPusatAudit() {
  const term = state.ui.auditSearch.trim().toLowerCase();
  const rows = D.audit.filter(e => !term || [e.action, e.summary, e.entity_type].some(x => String(x ?? '').toLowerCase().includes(term)));
  const body = rows.length ? tableWrap(['Waktu', 'Aksi', 'Ringkasan', 'Objek'], rows.map(e => `<tr>
    <td>${esc(dateTime(e.created_at || e.at))}<small>${esc(timeAgo(e.created_at || e.at))}</small></td>
    <td>${badge(String(e.action || '').replaceAll('_', ' '), /OVERRIDE|CLOSE|DELETE|LOGOUT/.test(e.action) ? 'orange' : /OPEN|SEND|LOGIN/.test(e.action) ? 'blue' : 'gray', true)}</td>
    <td>${esc(e.summary)}</td><td><small>${esc(e.entity_type || '')}</small></td></tr>`)) : empty('Tidak ada catatan', 'Aktivitas sistem akan tercatat di sini.', 'list');
  return `${pageHead('Log audit', 'Riwayat tindakan penting: alarm, operasi, perubahan data, dan akses data warga oleh Rescue.')}
    ${card({ title: `${rows.length} catatan`, sub: 'Disimpan untuk keamanan dan evaluasi', flush: true, body: `<div class="toolbar"><label class="search">${icon('search')}<input type="search" placeholder="Cari aksi atau ringkasan…" value="${esc(state.ui.auditSearch)}" data-bind="auditSearch" data-keep-focus="1"></label></div>${body}` })}`;
}

/* ----------------------------------------------------------- Tampilan: Desa */
function operationCard(op) {
  return `<section class="op-card"><div class="op-head"><div><span class="badge red">Operasi berjalan</span><h2 style="margin-top:8px">${esc(op.disasterType)} · ${esc(op.areaLabel)}</h2>
      <small>Dibuka ${esc(dateTime(op.openedAt))}. JAGA Rescue memiliki akses ke warga berkalung di area ini.</small></div>
      <div class="page-actions"><button class="btn outline sm" data-action="open-modal" data-modal="water" data-id="${esc(op.id)}">${icon('water')} Perbarui tinggi air</button>
      <button class="btn danger sm" data-action="open-modal" data-modal="close-op" data-id="${esc(op.id)}">Tutup operasi</button></div></div>
    <div class="op-facts"><div class="fact"><small>Tingkat</small><b>${esc((SEVERITY[op.severity] || [op.severity])[0])}</b></div>
      <div class="fact"><small>Tinggi air</small><b>${op.waterLevelCm != null ? `${op.waterLevelCm} cm` : '—'}</b></div>
      <div class="fact"><small>Area</small><b>${esc(op.areaLabel)}</b></div></div>${op.note ? `<div style="padding:0 20px 18px"><small>Catatan: ${esc(op.note)}</small></div>` : ''}</section>`;
}

function attentionItemsDesa() {
  const items = [];
  D.incidents.filter(isActive).forEach(i => items.push({ tone: 'red', name: 'alert', title: `${i.ownerName || 'Warga'} · ${(STATUS[i.status] || [i.status])[0]}`, sub: `SOS ${timeAgo(i.createdAt)} · ${i.description || 'tanpa keterangan'}` }));
  D.devices.filter(d => d.residentId && !d.online).forEach(d => items.push({ tone: 'red', name: 'device', title: `Kalung ${d.residentName || d.id} offline`, sub: `Sinyal terakhir ${timeAgo(d.lastSeenAt)}` }));
  D.devices.filter(d => d.residentId && d.online && num(d.battery) !== null && d.battery <= 20).forEach(d => items.push({ tone: 'orange', name: 'battery', title: `Baterai ${d.residentName || d.id} ${d.battery}%`, sub: 'Segera ganti atau isi daya' }));
  const unrated = D.residents.filter(r => !r.evacuationAbility).length;
  if (unrated) items.push({ tone: 'yellow', name: 'info', title: `${unrated} warga belum dinilai kemampuan evakuasinya`, sub: 'Data ini menentukan urutan prioritas penyelamatan' });
  return items;
}

function viewDesaBeranda() {
  const c = D.overview?.counters || {};
  const op = D.operations[0];
  const items = attentionItemsDesa();
  const assigned = D.devices.filter(d => d.residentId);
  const banner = op ? operationCard(op) : callout({ tone: 'blue', icon: 'shield', title: 'Tidak ada operasi berjalan', text: 'Operasi dibuka otomatis saat Anda membunyikan alarm Siaga atau Evakuasi untuk seluruh desa atau dusun.', actions: `<a class="btn primary sm" href="#/alarm">${icon('bell')} Buka alarm</a>` });
  const breakdown = D.safety?.breakdown || [];
  return `${pageHead('Beranda desa', 'Kondisi terkini warga rentan, kalung, dan kejadian di desa Anda.')}
    <div class="stack">${banner}
    <div class="kpis">
      ${kpi({ icon: 'users', label: 'Warga terdaftar', value: D.residents.length, hint: `${D.residents.filter(r => r.deviceId).length} berkalung` })}
      ${kpi({ icon: 'device', label: 'Kalung online', value: `${assigned.filter(d => d.online).length}/${assigned.length}`, hint: `${assigned.filter(d => num(d.battery) !== null && d.battery <= 20).length} baterai rendah`, tone: 'blue' })}
      ${kpi({ icon: 'alert', label: 'SOS aktif', value: D.incidents.filter(isActive).length, hint: 'Perlu ditindaklanjuti', tone: D.incidents.some(isActive) ? 'red' : '' })}
      ${kpi({ icon: 'check', label: 'Warga dinyatakan aman', value: D.safety?.safe ?? 0, hint: `${D.safety?.waitingHelp ?? 0} menunggu bantuan` })}
    </div>
    <div class="grid two">
      ${card({ title: 'Peta desa', sub: 'Titik warga, zona bahaya, dan titik kumpul', flush: true, extra: 'has-legend', body: `<div class="map-box" data-map="village"></div>${mapLegend('village')}` })}
      <div class="stack">
        ${card({ title: 'Perlu tindak lanjut', sub: `${items.length} hal`, flush: true, body: items.length ? `<div class="list">${items.slice(0, 7).map(i => attentionRow(i.tone, i.name, i.title, i.sub)).join('')}</div>` : empty('Semua terkendali', 'Tidak ada hal mendesak saat ini.') })}
        ${breakdown.length ? card({ title: 'Status warga', flush: true, body: `<div class="list">${breakdown.map(b => `<div class="row-item"><span class="dot ${({ safe: 'green', inProgress: 'blue', waiting: 'orange', normal: 'gray' })[b.key] || 'gray'}"></span><div class="grow"><b>${esc(b.label)}</b></div><b>${b.value}</b></div>`).join('')}</div>` }) : ''}
      </div>
    </div></div>`;
}

function viewDesaWarga() { return residentsView({ canAdd: true, withVillage: false }); }

function viewDesaAlarm() {
  const a = state.ui.alarm;
  const levels = [['WASPADA', 'Waspada', 'Peringatan dini. Tidak membuka operasi Rescue.'], ['SIAGA', 'Siaga', 'Bersiap mengungsi. Membuka operasi Rescue.'], ['EVAKUASI', 'Evakuasi', 'Segera mengungsi. Membuka operasi Rescue.']];
  const devices = D.devices.filter(d => d.residentId);
  const opens = ['SIAGA', 'EVAKUASI'].includes(a.severity) && a.target === 'ALL';
  const history = D.alerts.slice(0, 8);
  const form = `<form data-form="alarm-review" class="card-body" style="display:grid;gap:18px">
    <div><div class="field"><span>Tingkat peringatan</span></div><div class="levels" style="margin-top:8px">
      ${levels.map(([v, l, h]) => `<button type="button" class="level ${v} ${a.severity === v ? 'active' : ''}" data-action="severity" data-value="${v}"><b>${l}</b><small>${h}</small></button>`).join('')}</div></div>
    <label class="field">Target<select data-bind="alarm.target"><option value="ALL" ${a.target === 'ALL' ? 'selected' : ''}>Seluruh kalung di area terpilih</option>${devices.map(d => `<option value="${esc(d.id)}" ${a.target === d.id ? 'selected' : ''}>${esc(d.residentName || d.ownerName || d.id)} · ${esc(d.id)}</option>`).join('')}</select></label>
    <fieldset ${a.target !== 'ALL' ? 'disabled' : ''}><legend>Area terdampak</legend>
      <p style="color:var(--muted);margin-bottom:10px">Pilih dusun yang terdampak, atau kosongkan untuk seluruh desa. Anda dapat memperluas area kapan saja.</p>
      <div class="checks">${D.hamlets.map(h => `<label class="check"><input type="checkbox" data-bind-hamlet="${esc(h.id)}" ${a.hamletIds.includes(h.id) ? 'checked' : ''}><span>${esc(h.name)}</span></label>`).join('') || '<small>Belum ada data dusun; alarm berlaku untuk seluruh desa.</small>'}</div></fieldset>
    <div class="form-grid"><label class="field">Tinggi air terpantau (cm)<input type="number" min="0" max="2000" placeholder="mis. 100 untuk 1 meter" value="${esc(a.waterLevelCm)}" data-bind="alarm.waterLevelCm"><small>Hasil pengamatan Anda, bukan sensor.</small></label>
      <label class="field">Catatan pengamatan<input type="text" maxlength="300" placeholder="mis. Sungai naik, titik rendah tergenang" value="${esc(a.note)}" data-bind="alarm.note"></label></div>
    <label class="field">Pesan untuk warga<textarea placeholder="${esc(DEFAULT_MESSAGE[a.severity])}" data-bind="alarm.message">${esc(a.message)}</textarea><small>Kosongkan untuk memakai pesan standar.</small></label>
    ${opens ? callout({ tone: 'yellow', icon: 'signal', title: 'Alarm ini membuka operasi Rescue', text: 'JAGA Rescue akan melihat warga berkalung di area terpilih selama operasi berjalan.' }) : ''}
    <button type="submit" class="btn primary block">${icon('bell')} Tinjau & aktifkan alarm</button></form>`;
  const historyBody = history.length ? `<div class="list">${history.map(h => `<div class="row-item"><span class="row-icon ${SEVERITY[h.severity]?.[1] || ''}">${icon('bell')}</span><div class="grow"><b>${esc(h.message || h.target)}</b><small>${esc(h.target)} · ${esc(timeAgo(h.createdAt))}</small></div>${severityBadge(h.severity)}<small>${h.receipts?.acknowledged ?? 0}/${h.receipts?.total ?? 0} dikonfirmasi</small></div>`).join('')}</div>` : empty('Belum ada alarm', '', 'bell');
  return `${pageHead('Alarm & operasi', 'Bunyikan alarm ke kalung warga setelah kondisi diverifikasi. Anda yang paling tahu keadaan lapangan.')}
    <div class="grid two">${card({ title: 'Aktifkan alarm', sub: 'Dikonfirmasi manusia sebelum dikirim', flush: true, body: form })}
      <div class="stack">${D.operations.length ? D.operations.map(operationCard).join('') : ''}${card({ title: 'Riwayat alarm', flush: true, body: historyBody })}</div></div>`;
}

function viewDesaKalung() {
  const rows = D.devices.slice().sort((a, b) => (a.online ? 1 : 0) - (b.online ? 1 : 0) || (num(a.battery) ?? 100) - (num(b.battery) ?? 100));
  const assigned = rows.filter(d => d.residentId);
  const body = rows.length ? tableWrap(['Kalung', 'Warga', 'Baterai', 'Koneksi', 'Terakhir aktif', 'Status'], rows.map(d => `<tr>
    <td><b>${esc(d.id)}</b><small>${esc(d.model || '')} ${d.firmwareVersion ? `· fw ${esc(d.firmwareVersion)}` : ''}</small></td>
    <td>${esc(d.residentName || (d.status === 'STOCK' ? 'Stok' : '—'))}</td><td>${batteryCell(d.battery)}</td>
    <td>${d.online ? badge('Online', 'green') : badge('Offline', 'red')}</td><td>${esc(timeAgo(d.lastSeenAt))}</td>
    <td>${badge({ ASSIGNED: 'Terpasang', STOCK: 'Stok', MAINTENANCE: 'Perawatan', LOST: 'Hilang', RETIRED: 'Dipensiunkan' }[d.status] || d.status, 'gray', true)}</td></tr>`)) : empty('Belum ada kalung', '', 'device');
  return `${pageHead('Kesehatan kalung', 'Pantau baterai dan koneksi. Kalung offline tidak dapat menerima alarm.')}
    <div class="stack"><div class="kpis">
      ${kpi({ icon: 'device', label: 'Terpasang', value: assigned.length, hint: `${rows.length - assigned.length} di stok` })}
      ${kpi({ icon: 'signal', label: 'Online', value: assigned.filter(d => d.online).length, hint: 'Menerima alarm', tone: 'blue' })}
      ${kpi({ icon: 'alert', label: 'Offline', value: assigned.filter(d => !d.online).length, hint: 'Perlu dicek', tone: assigned.some(d => !d.online) ? 'red' : '' })}
      ${kpi({ icon: 'battery', label: 'Baterai rendah', value: assigned.filter(d => num(d.battery) !== null && d.battery <= 20).length, hint: '20% atau kurang', tone: 'orange' })}
    </div>${card({ title: 'Seluruh kalung', flush: true, body })}</div>`;
}

function incidentActions(i) {
  const role = state.role;
  const flow = role === 'rescue'
    ? { NEW: ['ASSIGNED', 'Terima tugas'], ACKNOWLEDGED: ['ASSIGNED', 'Terima tugas'], ASSIGNED: ['EN_ROUTE', 'Berangkat'], EN_ROUTE: ['ARRIVED', 'Tiba di lokasi'], ARRIVED: ['EVACUATED', 'Evakuasi'], EVACUATED: ['SAFE', 'Dinyatakan aman'] }
    : { NEW: ['ACKNOWLEDGED', 'Konfirmasi'], ACKNOWLEDGED: ['SAFE', 'Dinyatakan aman'], ASSIGNED: ['SAFE', 'Dinyatakan aman'], EN_ROUTE: ['SAFE', 'Dinyatakan aman'], ARRIVED: ['SAFE', 'Dinyatakan aman'], EVACUATED: ['SAFE', 'Dinyatakan aman'] };
  const next = flow[i.status];
  const buttons = [];
  if (next) buttons.push(`<button class="btn primary sm" data-action="incident-status" data-id="${esc(i.id)}" data-status="${next[0]}">${esc(next[1])}</button>`);
  if (role !== 'rescue' && isActive(i)) buttons.push(`<button class="btn outline sm" data-action="incident-status" data-id="${esc(i.id)}" data-status="CLOSED">Tutup</button>`);
  return buttons.join(' ') || '<small>—</small>';
}
function viewIncidents(title, sub) {
  const all = D.incidents;
  const rows = state.ui.incidentFilter === 'active' ? all.filter(isActive) : all;
  const body = rows.length ? tableWrap(['Warga', 'Status', 'Kejadian', 'Tim', 'Aksi'], rows.map(i => `<tr>
    <td><div class="cell-flex"><span class="avatar-sm">${esc(initials(i.ownerName))}</span><div><b>${esc(i.ownerName || '—')}</b><small>${esc(timeAgo(i.createdAt))} · ${esc(dateTime(i.createdAt))}</small></div></div></td>
    <td>${statusBadge(i.status)}</td><td>${esc(i.disasterType || '—')}<small>${esc(i.description || '')}</small></td>
    <td>${(i.teams || []).map(t => esc(t.name)).join(', ') || '<small>Belum ada tim</small>'}</td><td>${incidentActions(i)}</td></tr>`)) : empty(state.ui.incidentFilter === 'active' ? 'Tidak ada kejadian aktif' : 'Belum ada kejadian', 'SOS dari kalung akan muncul di sini.', 'alert');
  return `${pageHead(title, sub)}${card({ title: `${rows.length} kejadian`, flush: true, body: `<div class="toolbar"><div class="segmented">
    <button class="${state.ui.incidentFilter === 'active' ? 'active' : ''}" data-action="incident-filter" data-value="active">Aktif</button>
    <button class="${state.ui.incidentFilter === 'all' ? 'active' : ''}" data-action="incident-filter" data-value="all">Semua</button></div></div>${body}` })}`;
}
function viewDesaKejadian() { return viewIncidents('Kejadian', 'SOS dan laporan dari warga. Penugasan tim dilakukan komandan Rescue lewat operasi yang dibuka alarm Anda.'); }

function viewMapPage(kind) {
  const label = state.role === 'rescue' ? 'Peta operasi' : 'Peta';
  return `${pageHead(label, state.role === 'rescue' ? 'Pin berwarna menurut prioritas penyelamatan. Klik pin untuk melihat alasan dan kontak.' : 'Sebaran warga, zona bahaya, titik kumpul, dan tim.')}
    ${card({ title: 'Peta', flush: true, extra: 'has-legend', body: `<div class="map-box tall" data-map="${kind}"></div>${mapLegend(kind)}` })}`;
}

/* -------------------------------------------------------- Tampilan: Rescue */
function priorityList(rows) {
  if (!rows.length) return empty('Belum ada operasi aktif', 'Data warga baru terbuka setelah JAGA Desa membunyikan alarm Siaga atau Evakuasi.', 'shield');
  return `<div class="prio-list">${rows.map((r, i) => {
    const color = r.priority?.color || 'green';
    return `<article class="prio-card ${color}"><div class="prio-top"><b><span class="prio-rank ${color}">${i + 1}</span>${esc(r.fullName)}</b>${prioBadge(r.priority)}</div>
      <div class="prio-meta">${esc((r.vulnerabilities || []).map(v => v.name).join(', ') || '—')} · ${esc(r.hamletName || '—')}${r.livesAlone ? ' · <b>tinggal sendiri</b>' : ''}</div>
      <div class="prio-meta"><b>${esc((ABILITY[r.evacuationAbility] || ['Kemampuan evakuasi belum dinilai'])[0])}</b>${r.timeCriticalMedical ? ' · <b>medis mendesak</b>' : ''}</div>
      <div class="why"><b>Mengapa ${esc(PRIO_NAME[color])} · skor ${esc(r.priority?.score ?? '—')}</b>${esc(topReasons(r) || 'Belum ada aturan prioritas aktif.')}</div>
      <div class="prio-foot">${r.activeIncident ? `<span class="badge red">SOS · ${esc((STATUS[r.activeIncident.status] || [''])[0])}</span>` : ''}${r.device && !r.device.online ? '<span class="badge red">Kalung offline</span>' : ''}${(r.contacts || []).slice(0, 1).map(c => `<span class="badge gray plain">${esc(c.name)} · ${esc(c.phone)}</span>`).join('')}</div></article>`;
  }).join('')}</div>`;
}
function viewRescuePrioritas() {
  const rows = sortedByPriority(rosterRows());
  const count = c => rows.filter(r => r.priority?.color === c).length;
  const ops = D.operations;
  const banner = ops.length
    ? callout({ tone: 'red', icon: 'signal', title: `${ops.length} operasi aktif: ${ops.map(o => `${o.villageName} (${o.areaLabel})`).join('; ')}`, text: 'Komandan menentukan tim dan urutan di lapangan. Prioritas berikut adalah rekomendasi sistem beserta alasannya.' })
    : callout({ tone: 'blue', icon: 'shield', title: 'Belum ada operasi aktif', text: 'Anda akan diberi tahu saat JAGA Desa membunyikan alarm Siaga atau Evakuasi.' });
  return `${pageHead('Prioritas penyelamatan', 'Siapa yang perlu dijangkau lebih dulu, diurutkan menurut ancaman, kemampuan mengungsi, dan kebutuhan medis.')}
    <div class="stack">${banner}
    <div class="kpis">
      ${kpi({ icon: 'alert', label: 'Merah · Darurat', value: count('red'), hint: 'Tangani lebih dulu', tone: 'red' })}
      ${kpi({ icon: 'signal', label: 'Oranye · Respons cepat', value: count('orange'), hint: 'Segera kirim bantuan', tone: 'orange' })}
      ${kpi({ icon: 'clock', label: 'Kuning · Tinjau', value: count('yellow'), hint: 'Pantau dan tinjau', tone: 'yellow' })}
      ${kpi({ icon: 'check', label: 'Hijau · Pantau', value: count('green'), hint: 'Pantau berkala', tone: 'green' })}
    </div>
    <div class="grid rescue-home">
      ${card({ title: 'Peta prioritas', sub: `${rows.length} pemakai kalung di area operasi`, flush: true, extra: 'has-legend', body: `<div class="map-box tall" data-map="rescue"></div>${mapLegend('rescue')}` })}
      ${card({ title: 'Urutan penyelamatan', sub: 'Keputusan akhir oleh komandan', flush: true, body: `<div class="legend">${Object.keys(PRIO_RANK).map(c => `<span><i class="dot ${c}"></i>${PRIO_NAME[c]} ${count(c)}</span>`).join('')}</div>${priorityList(rows)}` })}
    </div></div>`;
}

function rosterTable(rows) {
  if (!rows.length) return empty('Belum ada pemakai kalung di area ini', '', 'users');
  return tableWrap(['Prioritas', 'Warga', 'Dusun', 'Kebutuhan evakuasi', 'Kontak darurat', 'Kalung', 'Status'], sortedByPriority(rows).map(r => `<tr title="${esc(topReasons(r, 6))}">
    <td>${prioBadge(r.priority)}<small>skor ${esc(r.priority?.score ?? '—')}</small></td>
    <td><b>${esc(r.fullName)}</b><small>${esc(r.ageGroup ? r.ageGroup.toLowerCase() : '')}${r.livesAlone ? ' · tinggal sendiri' : ''}${r.phone ? ` · <span class="nowrap">${esc(r.phone)}</span>` : ''}</small></td>
    <td>${esc(r.hamletName || '—')}${r.hamletUnknown ? '<small>dusun belum tercatat</small>' : ''}</td>
    <td>${groupChips(r.vulnerabilities)}<small>${esc(r.evacuationNotes || r.mobilityNotes || '')}</small>${r.medicalNotes ? `<small><b>Medis:</b> ${esc(r.medicalNotes)}</small>` : ''}</td>
    <td>${(r.contacts || []).map(c => `${esc(c.name)} · <span class="nowrap">${esc(c.phone)}</span>`).join('<br>') || '—'}</td>
    <td>${r.device?.online ? badge('Online', 'green') : badge('Offline', 'red')}<small>${esc(r.device?.battery ?? '—')}%</small></td>
    <td>${r.activeIncident ? badge(`SOS · ${(STATUS[r.activeIncident.status] || [''])[0]}`, 'red') : badge('Belum ada SOS', 'gray', true)}</td></tr>`));
}
function viewRescueOperasi() {
  if (!D.operations.length) return `${pageHead('Operasi', 'Daftar warga berkalung di area operasi aktif.')}${card({ title: 'Belum ada operasi aktif', body: empty('Belum ada operasi aktif', 'Operasi dibuka otomatis saat JAGA Desa membunyikan alarm Siaga/Evakuasi. Akses data warga dicabut saat operasi ditutup.', 'shield') })}`;
  return `${pageHead('Operasi', 'Daftar warga berkalung di area terdampak. Akses ini tercatat dan berakhir saat operasi ditutup.')}
    <div class="stack">${D.operations.map(op => card({
      title: `${op.villageName} · ${(SEVERITY[op.severity] || [op.severity])[0]}`,
      sub: `${op.disasterType} · area: ${op.areaLabel} · dibuka ${dateTime(op.openedAt)}${op.waterLevelCm != null ? ` · tinggi air ${op.waterLevelCm} cm` : ''}`,
      actions: `<button class="btn outline sm" data-action="op-pack" data-id="${esc(op.id)}">${icon('download')} Unduh paket offline</button>`,
      flush: true, body: `${op.note ? `<div style="padding:14px 20px"><small>Catatan Desa: ${esc(op.note)}</small></div>` : ''}${rosterTable(D.rosters[op.id] || [])}` })).join('')}</div>`;
}
function viewRescueTugas() { return viewIncidents('Tugas lapangan', 'Perbarui status penanganan warga. Perubahan langsung terlihat oleh JAGA Desa.'); }

function viewRescueTim() {
  const mine = state.session?.organizationId;
  const body = D.teams.length ? tableWrap(['Tim', 'Kendaraan', 'Status', 'Anggota', 'Posisi terakhir'], D.teams.map(t => {
    const own = t.organizationId === mine;
    const status = own
      ? `<select class="status-select" data-change="team-status" data-id="${esc(t.id)}">${Object.entries(TEAM_STATUS).map(([v, l]) => `<option value="${v}" ${t.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`
      : badge(TEAM_STATUS[t.status] || t.status, t.status === 'AVAILABLE' ? 'green' : 'blue');
    return `<tr><td><b>${esc(t.name)}</b><small>${esc(t.callSign || '')}${own ? ' · tim Anda' : ''}</small></td><td>${esc(t.vehicleInfo || '—')}</td><td>${status}</td>
      <td>${t.memberCount ?? 0}</td><td>${t.latitude != null ? `${Number(t.latitude).toFixed(4)}, ${Number(t.longitude).toFixed(4)}<small>${esc(timeAgo(t.updatedAt))}</small>` : '<small>Belum dilaporkan</small>'}</td></tr>`;
  })) : empty('Belum ada tim', '', 'truck');
  return `${pageHead('Tim', 'Status dan posisi tim di wilayah operasi. Anda dapat mengubah status tim organisasi Anda.')}${card({ title: `${D.teams.length} tim`, flush: true, body })}`;
}

/* ---------------------------------------------------------------- Peta */
const MAP_LEGENDS = {
  rescue: [['red', 'Merah'], ['orange', 'Oranye'], ['yellow', 'Kuning'], ['green', 'Hijau'], ['blue', 'Titik kumpul'], ['gray', 'Zona bahaya']],
  village: [['red', 'SOS aktif'], ['green', 'Warga'], ['blue', 'Titik kumpul'], ['gray', 'Zona bahaya']],
  overview: [['red', 'SOS aktif'], ['green', 'Warga'], ['blue', 'Titik kumpul'], ['gray', 'Zona bahaya']]
};
function mapLegend(kind) {
  return `<div class="map-legend">${(MAP_LEGENDS[kind] || MAP_LEGENDS.village).map(([c, l]) => `<span><i class="dot ${c}"></i>${l}</span>`).join('')}<span><i class="dot blue" style="border-radius:3px"></i>Tim · Gateway</span></div>`;
}
const zoneColor = risk => (risk >= 5 ? '#c8372d' : risk >= 4 ? '#e2700d' : '#d9a406');
const pinIcon = (color, sos = false) => L.divIcon({ className: '', html: `<div class="pin ${color}${sos ? ' sos' : ''}"></div>`, iconSize: [20, 20], iconAnchor: [10, 10] });
const squareIcon = (kind, text) => L.divIcon({ className: '', html: `<div class="pin-sq ${kind}">${text}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] });

function mountMaps() {
  $$('[data-map]').forEach(el => {
    if (!window.L) { el.innerHTML = '<div class="map-fallback"><div><b>Peta tidak dapat dimuat</b><br><small>Periksa koneksi internet.</small></div></div>'; return; }
    const kind = el.dataset.map, map = L.map(el, { scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    const bounds = [], source = D.map || { residents: [], hazardZones: [], shelters: [], teams: [], gateways: [], incidents: [] };
    const add = (lat, lng) => { if (num(lat) !== null && num(lng) !== null) bounds.push([Number(lat), Number(lng)]); };

    source.hazardZones.forEach(z => {
      if (num(z.centerLatitude) === null) return;
      const color = zoneColor(z.riskLevel);
      L.circle([z.centerLatitude, z.centerLongitude], { radius: z.radiusMeters || 200, color, weight: 2, dashArray: '6 6', fillColor: color, fillOpacity: .13 })
        .bindTooltip(`${esc(z.name)} · risiko ${z.riskLevel}`).addTo(map);
      add(z.centerLatitude, z.centerLongitude);
    });
    if (kind === 'rescue') {
      sortedByPriority(rosterRows()).reverse().forEach(r => {
        if (num(r.latitude) === null) return;
        const color = r.priority?.color || 'green';
        L.marker([r.latitude, r.longitude], { icon: pinIcon(color, color === 'red' && r.activeIncident) })
          .bindPopup(`<b>${esc(r.fullName)}</b><br>${prioBadge(r.priority)} skor ${esc(r.priority?.score ?? '—')}<br><small>${esc(topReasons(r, 2))}</small><br><small>${(r.contacts || []).map(c => `${esc(c.name)} ${esc(c.phone)}`).join('; ')}</small>`)
          .bindTooltip(esc(r.fullName)).addTo(map);
        add(r.latitude, r.longitude);
      });
    } else {
      const sosByResident = new Set(D.incidents.filter(isActive).map(i => i.residentId));
      source.residents.forEach(r => {
        if (num(r.latitude) === null) return;
        const sos = sosByResident.has(r.id);
        L.marker([r.latitude, r.longitude], { icon: pinIcon(sos ? 'red' : 'green', sos) }).bindTooltip(esc(r.fullName)).addTo(map);
        add(r.latitude, r.longitude);
      });
    }
    source.shelters.forEach(s => { if (num(s.latitude) !== null) { L.marker([s.latitude, s.longitude], { icon: squareIcon('shelter', 'T') }).bindTooltip(`${esc(s.name)}${s.capacity ? ` · kapasitas ${s.capacity}` : ''}`).addTo(map); add(s.latitude, s.longitude); } });
    source.teams.forEach(t => { if (num(t.latitude) !== null) { L.marker([t.latitude, t.longitude], { icon: squareIcon('team', 'R') }).bindTooltip(`${esc(t.name)} · ${esc(TEAM_STATUS[t.status] || t.status)}`).addTo(map); if (kind === 'overview') add(t.latitude, t.longitude); } });
    source.gateways.forEach(g => { if (num(g.latitude) !== null) { L.marker([g.latitude, g.longitude], { icon: squareIcon('gateway', 'G') }).bindTooltip(`${esc(g.name)} · ${g.online ? 'online' : 'offline'}`).addTo(map); if (kind === 'overview') add(g.latitude, g.longitude); } });

    if (bounds.length) map.fitBounds(bounds, { padding: [34, 34], maxZoom: 17 }); else map.setView([4.83, 97.42], 12);
    map.on('click', () => map.scrollWheelZoom.enable());
    state.maps.push(map);
    setTimeout(() => map.invalidateSize(), 60);
  });
}
function destroyMaps() { state.maps.forEach(m => { try { m.remove(); } catch { /* peta sudah dilepas */ } }); state.maps = []; }

/* --------------------------------------------------------- Rute tampilan */
const VIEWS = {
  pusat: { ringkasan: viewPusatRingkasan, desa: viewPusatDesa, warga: () => residentsView({ canAdd: false, withVillage: true }), aturan: viewPusatAturan, akun: viewPusatAkun, laporan: viewPusatLaporan, audit: viewPusatAudit },
  desa: { beranda: viewDesaBeranda, warga: viewDesaWarga, alarm: viewDesaAlarm, kalung: viewDesaKalung, kejadian: viewDesaKejadian, peta: () => viewMapPage('village') },
  rescue: { prioritas: viewRescuePrioritas, operasi: viewRescueOperasi, tugas: viewRescueTugas, tim: viewRescueTim, peta: () => viewMapPage('rescue') }
};
function currentRoute() {
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  const config = ROLES[state.role];
  return config.pages.some(p => p[0] === id) ? id : config.home;
}

/* -------------------------------------------------------------- Navbar */
function scopeLabel() {
  const s = state.session;
  if (state.role === 'pusat') return 'Seluruh wilayah';
  if (state.role === 'desa') return (s.villageNames || []).join(', ') || s.organizationName || '—';
  return s.organizationName || '—';
}
function notificationTitle(n) {
  const match = /^ALERT_(WASPADA|SIAGA|EVAKUASI)$/.exec(n.title || '');
  return match ? `Peringatan ${SEVERITY[match[1]][0]}` : n.title;
}
function renderNavbar() {
  const bar = $('#navbar');
  if (!state.session) { bar.hidden = true; return; }
  bar.hidden = false;
  const config = ROLES[state.role], route = currentRoute(), s = state.session;
  const useSidebar = config.nav === 'sidebar';
  const c = D.overview?.counters || {};
  const unread = D.notifications.filter(n => n.status !== 'READ').length;
  const activeIncidents = D.incidents.filter(isActive).length;
  const pill = state.error ? '<span class="status-pill bad"><i></i>Koneksi bermasalah</span>'
    : state.role === 'rescue' ? `<span class="status-pill"><i></i>Terhubung<small>${D.operations.length} operasi</small></span>`
      : `<span class="status-pill"><i></i>Terhubung<small>${c.devicesOnline ?? 0}/${c.devicesTotal ?? 0} kalung</small></span>`;
  const tabBadge = id => ((id === 'kejadian' || id === 'tugas') && activeIncidents) ? `<span class="badge-mini">${activeIncidents}</span>` : (id === 'operasi' && D.operations.length) ? `<span class="badge-mini">${D.operations.length}</span>` : '';
  let menu = '';
  if (state.ui.menu === 'notif') {
    const items = D.notifications.slice(0, 8);
    menu = `<div class="menu" data-menu-panel><div class="menu-head"><b>Notifikasi</b><small>${unread} belum dibaca</small></div><div class="menu-list">${items.length ? items.map(n => `<div class="menu-item"><b>${esc(notificationTitle(n))}</b><small>${esc(n.body)}</small><small>${esc(timeAgo(n.createdAt))}</small></div>`).join('') : '<div class="menu-empty">Belum ada notifikasi</div>'}</div></div>`;
  } else if (state.ui.menu === 'user') {
    menu = `<div class="menu" data-menu-panel><div class="menu-head"><b>${esc(s.displayName)}</b><small>${esc(s.email)}</small><small>${esc(config.label)} · ${esc(scopeLabel())}</small></div><a class="menu-item" href="/"><b>Halaman depan JAGA</b></a><button class="menu-item danger" data-action="logout">${icon('logout')} Keluar</button></div>`;
  }
  bar.innerHTML = `<div class="navbar-top">
      <a class="brand" href="#/${config.home}"><img src="assets/logo-mark.png" alt="Logo JAGA"><span class="brand-text"><b>JAGA</b><small>Siaga bersama</small></span></a>
      <div class="context"><span class="role-badge"><i class="dot"></i>${esc(config.label)}</span><span class="context-name">${esc(scopeLabel())}</span></div>
      <div class="nav-actions">${pill}
        <button class="icon-btn" data-action="menu" data-menu="notif" aria-label="Notifikasi">${icon('bell')}${unread ? `<span class="count">${unread > 9 ? '9+' : unread}</span>` : ''}</button>
        <button class="avatar" data-action="menu" data-menu="user" aria-label="Akun saya">${esc(initials(s.displayName))}</button></div>${menu}</div>
    ${useSidebar ? '' : `<nav class="tabs" aria-label="Menu utama">${config.pages.map(([id, label, name]) => `<a class="tab ${id === route ? 'active' : ''}" href="#/${id}">${icon(name)}${esc(label)}${tabBadge(id)}</a>`).join('')}</nav>`}`;
  bar.classList.toggle('sidebar-mode', useSidebar);
  const side = $('#sidebar');
  $('#layout').classList.toggle('with-sidebar', useSidebar);
  side.hidden = !useSidebar;
  side.innerHTML = useSidebar
    ? `<div class="side-label">Menu</div><nav class="side-nav">${config.pages.map(([id, label, name]) => `<a class="side-link ${id === route ? 'active' : ''}" href="#/${id}">${icon(name)}<span>${esc(label)}</span>${tabBadge(id)}</a>`).join('')}</nav><div class="side-foot">Sistem pendukung keputusan.<br>Keputusan akhir tetap pada petugas.</div>`
    : '';
  $('#demoBar').innerHTML = state.demo ? '<div class="demo-bar">Mode demo: seluruh data warga, kalung, dan tim adalah data dummy. Wilayah dan nama desa bersumber dari data publik.</div>' : '';
}

/* ---------------------------------------------------------------- Modal */
const modalRoot = () => $('#modalRoot');
function modalShell({ title, sub = '', body, foot, wide = false }) {
  return `<div class="modal-backdrop" data-action="close-modal-bg"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div><button class="icon-btn" data-action="close-modal" aria-label="Tutup">${icon('x')}</button></div>
    <div class="modal-body">${body}</div><div class="modal-foot">${foot}</div></div></div>`;
}
function residentModal() {
  const types = D.vulnTypes;
  const body = `<form id="modalForm" data-form="resident" class="form-grid">
    <label class="field wide">Nama lengkap<input name="fullName" required minlength="3" maxlength="160"></label>
    <label class="field">Tanggal lahir<input name="birthDate" type="date"></label>
    <label class="field">Jenis kelamin<select name="gender"><option value="">Tidak diisi</option><option value="LAKI_LAKI">Laki-laki</option><option value="PEREMPUAN">Perempuan</option><option value="LAINNYA">Lainnya</option></select></label>
    <label class="field">Telepon<input name="phone" inputmode="tel"></label>
    <label class="field">Dusun<select name="hamletId"><option value="">Belum dipilih</option>${D.hamlets.map(h => `<option value="${esc(h.id)}">${esc(h.name)}</option>`).join('')}</select></label>
    <label class="field wide">Alamat<input name="address"></label>
    <label class="field">Latitude<input name="latitude" type="number" step="any" placeholder="4.8270"></label>
    <label class="field">Longitude<input name="longitude" type="number" step="any" placeholder="97.4160"></label>
    <fieldset class="wide"><legend>Kelompok rentan</legend><div class="checks">${types.map(t => `<label class="check"><input type="checkbox" name="vulnerability" value="${esc(t.code)}"><span>${esc(t.name)}<small>${esc(t.category)}</small></span></label>`).join('')}</div></fieldset>
    <label class="field wide">Kemampuan evakuasi mandiri<select name="evacuationAbility"><option value="">Belum dinilai</option><option value="MANDIRI">Dapat mengungsi sendiri</option><option value="PERLU_BANTUAN">Perlu bantuan mengungsi</option><option value="TIDAK_BISA_SENDIRI">Tidak bisa mengungsi sendiri</option></select><small>Menentukan prioritas penyelamatan. Isi berdasarkan penilaian langsung.</small></label>
    <label class="check wide"><input type="checkbox" name="timeCriticalMedical"><span>Kebutuhan medis yang tidak bisa ditunda<small>Insulin, oksigen, dialisis, atau persalinan sudah dekat</small></span></label>
    <label class="check wide"><input type="checkbox" name="livesAlone"><span>Tinggal sendiri</span></label>
    <label class="field">Catatan mobilitas<textarea name="mobilityNotes"></textarea></label>
    <label class="field">Catatan komunikasi<textarea name="communicationNotes"></textarea></label>
    <label class="field">Kondisi medis relevan<textarea name="medicalNotes"></textarea></label>
    <label class="field">Kebutuhan saat evakuasi<textarea name="evacuationNotes"></textarea></label>
    <label class="check wide"><input type="checkbox" name="consented" required><span>Persetujuan pendataan telah diperoleh dari warga atau walinya<small>Data kesehatan dan disabilitas adalah data pribadi yang sensitif.</small></span></label></form>`;
  return modalShell({ title: 'Tambah warga', sub: 'Data digunakan hanya untuk peringatan dan evakuasi.', body, wide: true,
    foot: `<button class="btn outline" data-action="close-modal">Batal</button><button class="btn primary" type="submit" form="modalForm">Simpan warga</button>` });
}
function accountModal() {
  const body = `<form id="modalForm" data-form="account" class="form-grid">
    <label class="field wide">Nama lengkap<input name="displayName" required maxlength="120"></label>
    <label class="field">Email<input name="email" type="email" required></label>
    <label class="field">Telepon<input name="phone" inputmode="tel"></label>
    <label class="field">Peran<select name="role" data-change="account-role"><option value="DESA">JAGA Desa</option><option value="RESCUE">JAGA Rescue</option><option value="PUSAT">JAGA Pusat</option></select></label>
    <label class="field">Kata sandi awal<input name="password" type="password" minlength="8" required autocomplete="new-password"><small>Minimal 8 karakter.</small></label>
    <label class="field" data-for="org">Nama organisasi<input name="organizationName" maxlength="160" placeholder="mis. Pemerintah Gampong Leubok Pusaka"></label>
    <label class="field" data-for="orgtype" hidden>Jenis organisasi<select name="organizationType">${Object.entries(ORG_TYPES).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
    <fieldset class="wide" data-for="villages"><legend>Wilayah akses</legend><div class="checks">${D.villages.map(v => `<label class="check"><input type="checkbox" name="villageIds" value="${esc(v.id)}"><span>${esc(v.name)}</span></label>`).join('') || '<small>Belum ada desa.</small>'}</div></fieldset></form>`;
  return modalShell({ title: 'Buat akun', sub: 'Sampaikan kata sandi awal kepada pengguna secara aman.', body,
    foot: `<button class="btn outline" data-action="close-modal">Batal</button><button class="btn primary" type="submit" form="modalForm">Buat akun</button>` });
}
function alarmConfirmModal(payload) {
  const names = D.hamlets.filter(h => payload.hamletIds.includes(h.id)).map(h => h.name);
  const opens = ['SIAGA', 'EVAKUASI'].includes(payload.severity) && payload.target === 'ALL';
  const target = payload.target === 'ALL' ? (names.length ? `kalung di ${names.join(', ')}` : 'seluruh kalung di desa') : `kalung ${payload.target}`;
  const body = `<p>Peringatan <b>${esc((SEVERITY[payload.severity] || [payload.severity])[0])}</b> akan dikirim ke <b>${esc(target)}</b>.</p>
    <div class="callout"><span class="callout-icon">${icon('info')}</span><div><b>Pesan</b><p>${esc(payload.message)}</p></div></div>
    ${opens ? callout({ tone: 'yellow', icon: 'signal', title: 'JAGA Rescue akan diberi akses otomatis', text: 'Rescue melihat warga berkalung di area ini sampai Anda menutup operasi.' }) : ''}
    <label class="check"><input type="checkbox" id="confirmCheck"><span>Saya telah memverifikasi kondisi dengan tim lapangan.</span></label>`;
  return modalShell({ title: 'Aktifkan alarm?', body, foot: `<button class="btn outline" data-action="close-modal">Batalkan</button><button class="btn danger" id="confirmSend" data-action="alarm-send" disabled>Aktifkan alarm</button>` });
}
function waterModal(op) {
  return modalShell({ title: 'Perbarui tinggi air', sub: `${op.disasterType} · ${op.areaLabel}`,
    body: `<form id="modalForm" data-form="water" data-id="${esc(op.id)}" style="display:grid;gap:14px"><label class="field">Tinggi air terpantau (cm)<input name="waterLevelCm" type="number" min="0" max="2000" value="${esc(op.waterLevelCm ?? '')}" placeholder="mis. 100 untuk 1 meter" autofocus><small>Pengamatan Anda memengaruhi warna prioritas seluruh warga.</small></label>
      <label class="field">Catatan<input name="note" maxlength="300" value="${esc(op.note ?? '')}"></label></form>`,
    foot: `<button class="btn outline" data-action="close-modal">Batal</button><button class="btn primary" type="submit" form="modalForm">Simpan</button>` });
}
function closeOpModal(op) {
  return modalShell({ title: 'Tutup operasi?', sub: `${op.disasterType} · ${op.areaLabel}`,
    body: `<p>Akses data warga untuk JAGA Rescue akan <b>dicabut</b>. Tindakan ini tercatat di log audit.</p><form id="modalForm" data-form="close-op" data-id="${esc(op.id)}"><label class="field">Catatan penutupan (opsional)<textarea name="note" maxlength="500"></textarea></label></form>`,
    foot: `<button class="btn outline" data-action="close-modal">Batal</button><button class="btn danger" type="submit" form="modalForm">Tutup operasi</button>` });
}
function renderModal() {
  const m = state.ui.modal, root = modalRoot();
  if (!m) { root.innerHTML = ''; return; }
  const op = D.operations.find(o => o.id === m.id);
  const html = m.type === 'resident' ? residentModal() : m.type === 'account' ? accountModal() : m.type === 'alarm-confirm' ? alarmConfirmModal(m.payload)
    : m.type === 'water' && op ? waterModal(op) : m.type === 'close-op' && op ? closeOpModal(op) : '';
  root.innerHTML = html;
  const form = $('#modalForm', root);
  if (form && m.type === 'account') syncAccountForm(form);
}
function openModal(modal) { state.ui.modal = modal; renderModal(); }
function closeModal() { state.ui.modal = null; renderModal(); flushPending(); }
function syncAccountForm(form) {
  const role = form.role.value;
  $('[data-for=org]', form).hidden = role === 'PUSAT';
  $('[data-for=orgtype]', form).hidden = role !== 'RESCUE';
  $('[data-for=villages]', form).hidden = role === 'PUSAT';
}

/* ----------------------------------------------------------- Aksi & form */
let toastTimer;
function toast(message, error = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 4200);
}
async function run(task, success) {
  try { const result = await task(); if (success) toast(success); await loadData(true); return result; }
  catch (error) { toast(`Gagal: ${error.message}`, true); return null; }
}
function download(filename, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
function exportCsv(kind) {
  const rows = kind === 'operations'
    ? [['Desa', 'Jenis', 'Tingkat', 'Area', 'Tinggi air (cm)', 'Dibuka', 'Ditutup', 'Catatan'], ...D.opsAll.map(o => [o.villageName, o.disasterType, o.severity, o.areaLabel, o.waterLevelCm, o.openedAt, o.closedAt, o.note])]
    : [['Warga', 'Desa', 'Jenis', 'Tingkat', 'Status', 'Dilaporkan', 'Keterangan'], ...D.incidents.map(i => [i.ownerName, villageName(i.villageId), i.disasterType, i.severity, i.status, i.createdAt, i.description])];
  download(`jaga-${kind}-${new Date().toISOString().slice(0, 10)}.csv`, rows.map(r => r.map(csvCell).join(',')).join('\n'));
}

const ACTIONS = {
  menu(el) { state.ui.menu = state.ui.menu === el.dataset.menu ? null : el.dataset.menu; renderNavbar(); },
  logout() { JagaApi.logout(); },
  'open-modal'(el) { openModal({ type: el.dataset.modal, id: el.dataset.id }); },
  'close-modal'() { closeModal(); },
  'close-modal-bg'(el, event) { if (event.target === el) closeModal(); },
  severity(el) { state.ui.alarm.severity = el.dataset.value; render(); },
  'resident-filter'(el) { state.ui.residentFilter = el.dataset.value; render(); },
  'incident-filter'(el) { state.ui.incidentFilter = el.dataset.value; render(); },
  'incident-status'(el) { run(() => JagaApi.updateIncidentStatus(el.dataset.id, el.dataset.status), 'Status diperbarui'); },
  'export-csv'(el) { exportCsv(el.dataset.kind); },
  async 'op-pack'(el) {
    try {
      const pack = await JagaApi.offlinePack(el.dataset.id);
      download(`jaga-operasi-${el.dataset.id.slice(0, 8)}.json`, JSON.stringify(pack, null, 2), 'application/json');
      toast('Paket offline diunduh. Hapus setelah operasi selesai.');
    } catch (error) { toast(`Gagal: ${error.message}`, true); }
  },
  async 'alarm-send'() {
    const m = state.ui.modal; if (!m?.payload) return;
    const p = m.payload, button = $('#confirmSend');
    button.disabled = true; button.textContent = 'Mengirim…';
    try {
      const body = p.target === 'ALL'
        ? { villageId: p.villageId, targetType: 'DESA', severity: p.severity, message: p.message, hamletIds: p.hamletIds, waterLevelCm: p.waterLevelCm, observationNote: p.note }
        : { villageId: p.villageId, targetType: 'PERANGKAT', targetReference: p.target, severity: p.severity, message: p.message };
      const result = await JagaApi.sendAlert(body);
      state.ui.alarm = { severity: 'SIAGA', target: 'ALL', message: '', hamletIds: [], waterLevelCm: '', note: '' };
      closeModal();
      toast(`Alarm masuk antrean untuk ${result.devicesReached} kalung${result.operation ? ' · operasi Rescue dibuka' : ''}`);
      await loadData(true);
    } catch (error) { toast(`Gagal mengirim: ${error.message}`, true); button.disabled = false; button.textContent = 'Aktifkan alarm'; }
  }
};

const FORMS = {
  'alarm-review'(form) {
    const a = state.ui.alarm;
    const villageId = ownVillageId();
    if (!villageId) return toast('Desa tujuan belum ditentukan', true);
    const water = a.waterLevelCm === '' ? undefined : Number(a.waterLevelCm);
    if (water !== undefined && (!Number.isFinite(water) || water < 0 || water > 2000)) return toast('Tinggi air harus 0 sampai 2000 cm', true);
    openModal({ type: 'alarm-confirm', payload: { villageId, severity: a.severity, target: a.target, hamletIds: a.target === 'ALL' ? a.hamletIds : [], message: a.message.trim() || DEFAULT_MESSAGE[a.severity], waterLevelCm: water, note: a.note.trim() || undefined } });
  },
  resident(form) {
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    delete payload.vulnerability;
    Object.assign(payload, {
      villageId: ownVillageId(), vulnerabilityCodes: data.getAll('vulnerability'), consented: data.has('consented'),
      livesAlone: data.has('livesAlone'), timeCriticalMedical: data.has('timeCriticalMedical')
    });
    for (const key of ['hamletId', 'birthDate', 'gender', 'evacuationAbility', 'latitude', 'longitude']) if (payload[key] === '') delete payload[key];
    run(() => JagaApi.createResident(payload), 'Data warga disimpan').then(ok => { if (ok) closeModal(); });
  },
  account(form) {
    const data = new FormData(form);
    const role = data.get('role');
    const payload = { displayName: data.get('displayName'), email: data.get('email'), phone: data.get('phone') || undefined, password: data.get('password'), role };
    if (role !== 'PUSAT') {
      payload.villageIds = data.getAll('villageIds');
      payload.organizationName = data.get('organizationName') || undefined;
      if (role === 'RESCUE') payload.organizationType = data.get('organizationType');
    }
    run(() => JagaApi.createAccount(payload), 'Akun dibuat').then(ok => { if (ok) closeModal(); });
  },
  water(form) {
    const data = new FormData(form), value = data.get('waterLevelCm');
    run(() => JagaApi.updateOperation(form.dataset.id, { waterLevelCm: value === '' ? null : Number(value), note: data.get('note') || null }), 'Tinggi air diperbarui').then(ok => { if (ok) closeModal(); });
  },
  'close-op'(form) {
    run(() => JagaApi.closeOperation(form.dataset.id, new FormData(form).get('note') || ''), 'Operasi ditutup; akses Rescue dicabut').then(ok => { if (ok) closeModal(); });
  }
};

function setPath(path, value) {
  const [group, key] = path.split('.');
  if (key) state.ui[group][key] = value; else state.ui[group] = value;
}

document.addEventListener('click', event => {
  const el = event.target.closest('[data-action]');
  if (el) { event.preventDefault(); ACTIONS[el.dataset.action]?.(el, event); return; }
  if (state.ui.menu && !event.target.closest('[data-menu-panel]')) { state.ui.menu = null; renderNavbar(); }
});
document.addEventListener('submit', event => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  FORMS[form.dataset.form]?.(form);
});
document.addEventListener('input', event => {
  const el = event.target;
  if (el.dataset.bind) {
    setPath(el.dataset.bind, el.value);
    if (el.dataset.keepFocus) { const pos = el.selectionStart; render(); const again = $(`[data-bind="${el.dataset.bind}"]`); if (again) { again.focus(); again.setSelectionRange(pos, pos); } }
  }
});
document.addEventListener('change', event => {
  const el = event.target;
  if (el.dataset.bind) { setPath(el.dataset.bind, el.value); if (el.dataset.bind === 'alarm.target') render(); }
  if (el.dataset.bindHamlet) {
    const list = state.ui.alarm.hamletIds, id = el.dataset.bindHamlet;
    state.ui.alarm.hamletIds = el.checked ? [...new Set([...list, id])] : list.filter(x => x !== id);
  }
  if (el.id === 'confirmCheck') { const send = $('#confirmSend'); if (send) send.disabled = !el.checked; }
  if (el.dataset.change === 'account-role') syncAccountForm(el.form);
  if (el.dataset.change === 'team-status') run(() => JagaApi.setTeamStatus(el.dataset.id, el.value), 'Status tim diperbarui');
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') { if (state.ui.modal) closeModal(); else if (state.ui.menu) { state.ui.menu = null; renderNavbar(); } } });
window.addEventListener('hashchange', () => { state.ui.menu = null; render(); window.scrollTo(0, 0); });

/* ----------------------------------------------------------- Render utama */
function render() {
  renderNavbar();
  const app = $('#app');
  if (!state.session) return;
  if (state.loading) { app.innerHTML = '<div class="loading"><div class="spinner"></div><span>Memuat data…</span></div>'; return; }
  if (state.error && !D.overview) {
    app.innerHTML = `<div class="card pad">${empty('Data belum dapat dimuat', state.error, 'alert')}<div style="text-align:center"><button class="btn primary" data-action="retry">Coba lagi</button></div></div>`;
    return;
  }
  destroyMaps();
  try { app.innerHTML = VIEWS[state.role][currentRoute()](); }
  catch (error) { console.error(error); app.innerHTML = `<div class="card pad">${empty('Tampilan gagal dimuat', error.message, 'alert')}</div>`; }
  mountMaps();
  renderModal();
}
ACTIONS.retry = () => loadData();

/** Pembaruan senyap tidak boleh merusak isian yang sedang diketik atau modal yang terbuka. */
function safeRender() {
  const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && document.activeElement.closest('#app');
  if (state.ui.modal || typing) { state.pendingRender = true; return; }
  render();
}
function flushPending() { if (state.pendingRender && !state.ui.modal) { state.pendingRender = false; render(); } }
document.addEventListener('focusout', () => setTimeout(flushPending, 150));

/* ------------------------------------------------------------ Pemuatan data */
async function loadData(silent = false) {
  if (!silent) { state.loading = true; state.error = ''; render(); }
  const safe = (promise, fallback) => promise.catch(() => fallback);
  const role = state.role;
  try {
    const [overview, safety, map, villages, hamlets, incidents, alerts, notifications, operations, vulnTypes] = await Promise.all([
      JagaApi.overview(), safe(JagaApi.safety(), null), safe(JagaApi.map(), null), JagaApi.villages(), safe(JagaApi.hamlets(), []),
      safe(JagaApi.incidents(), []), safe(JagaApi.alerts(), []), safe(JagaApi.notifications(), []), safe(JagaApi.operations('ACTIVE'), []), safe(JagaApi.vulnerabilityTypes(), [])
    ]);
    Object.assign(D, { overview, safety, map, villages, hamlets, incidents, alerts, notifications, operations, vulnTypes });

    if (role === 'rescue') {
      const rosters = {};
      await Promise.all(operations.map(async op => { rosters[op.id] = await safe(JagaApi.roster(op.id), []); }));
      D.rosters = rosters;
      D.teams = await safe(JagaApi.teams(), []);
      D.residents = []; D.devices = [];
    } else {
      [D.residents, D.devices] = await Promise.all([safe(JagaApi.residents(), []), safe(JagaApi.devices(), [])]);
    }
    if (role === 'pusat') {
      const [accounts, ruleSets, audit, opsAll] = await Promise.all([safe(JagaApi.accounts(), []), safe(JagaApi.ruleSets(), []), safe(JagaApi.audit(), []), safe(JagaApi.operations('ALL'), [])]);
      Object.assign(D, { accounts, ruleSets, audit, opsAll });
      const active = ruleSets.find(s => s.status === 'ACTIVE');
      D.activeRules = active ? await safe(JagaApi.ruleSet(active.id), null) : null;
      D.thresholds = active ? await safe(JagaApi.thresholds(active.id), []) : [];
    }
    state.error = '';
  } catch (error) {
    state.error = error.message;
    if (!silent) toast(`Gagal memuat: ${error.message}`, true);
  }
  state.loading = false;
  if (silent) safeRender(); else render();
}

/* ---------------------------------------------------------------- Boot */
async function boot() {
  try {
    const [session, config] = await Promise.all([JagaApi.me(), JagaApi.config().catch(() => ({}))]);
    state.session = session;
    state.role = String(session.role || 'DESA').toLowerCase();
    if (!ROLES[state.role]) state.role = 'desa';
    state.demo = !!config.demoData;
  } catch { return; }
  document.title = `${ROLES[state.role].label} — JAGA`;
  if (!location.hash || !ROLES[state.role].pages.some(p => `#/${p[0]}` === location.hash)) location.hash = `#/${ROLES[state.role].home}`;
  await loadData();
  JagaApi.stream((type, data) => {
    const who = data.owner_name || data.ownerName || 'warga';
    const messages = {
      'sos.created': `SOS diterima dari ${who}`, 'incident.updated': 'Status kejadian diperbarui', 'incident.closed': 'Kejadian ditutup',
      'alert.created': `Peringatan ${(SEVERITY[data.severity] || [data.severity])[0]} tercatat`, 'resident.created': 'Data warga baru ditambahkan',
      'operation.opened': 'Operasi dibuka: akses data warga berkalung di area terdampak', 'operation.updated': 'Operasi diperbarui', 'operation.closed': 'Operasi ditutup'
    };
    if (messages[type]) toast(messages[type]);
    loadData(true);
  });
  setInterval(() => loadData(true), 60000);
}

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
boot();
