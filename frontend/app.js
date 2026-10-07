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
const TIER = { NORMAL: ['Normal', 'green'], WASPADA: ['Waspada', 'yellow'], SIAGA: ['Siaga', 'orange'], AWAS: ['Awas', 'red'] };
const tierBadge = tier => badge((TIER[tier] || [tier])[0], (TIER[tier] || ['', 'gray'])[1]);
const SEVERITY = { WASPADA: ['Waspada', 'yellow'], SIAGA: ['Siaga', 'orange'], AWAS: ['Awas', 'red'] };
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
  AWAS: 'Awas: segera menuju titik aman bersama pendamping.'
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
      ['kalung', 'Kalung', 'device'], ['kendala', 'Kendala teknis', 'alert'], ['pengumuman', 'Pengumuman', 'bell'],
      ['aturan', 'Aturan prioritas', 'sliders'], ['akun', 'Akun & akses', 'shield'], ['platform', 'Platform & data', 'building'], ['laporan', 'Laporan', 'file'], ['audit', 'Log audit', 'list']]
  },
  desa: {
    label: 'JAGA Desa', home: 'beranda', nav: 'sidebar',
    pages: [['beranda', 'Beranda', 'home'], ['warga', 'Warga', 'users'], ['alarm', 'Alarm & operasi', 'bell'], ['status', 'Status warga', 'check'],
      ['kalung', 'Kalung', 'device'], ['kejadian', 'Kejadian', 'alert'], ['titik', 'Titik evakuasi', 'shield'], ['kendala', 'Kendala teknis', 'info'], ['peta', 'Peta', 'map']]
  },
  rescue: {
    label: 'JAGA Rescue', home: 'prioritas', nav: 'sidebar',
    pages: [['prioritas', 'Prioritas', 'activity'], ['operasi', 'Operasi', 'signal'], ['tugas', 'Tugas lapangan', 'route'],
      ['tim', 'Tim', 'truck'], ['laporan', 'Laporan operasi', 'file'], ['kendala', 'Kendala teknis', 'info'], ['peta', 'Peta', 'map']]
  }
};

/* --------------------------------------------------------------- State */
const state = {
  role: 'desa', session: null, loading: true, error: '', pendingRender: false, maps: [],
  data: {
    overview: null, safety: null, map: null, villages: [], vulnTypes: [], incidents: [], alerts: [], notifications: [],
    operations: [], shelters: [], tickets: [], board: null, announcements: [], reports: [], villageStat: null, platformInfo: null, governanceInfo: null, coverage: {}, draftRules: null, draftThresholds: [], residents: [], devices: [], teams: [], rosters: {}, accounts: [], ruleSets: [], activeRules: null, thresholds: [], audit: [], opsAll: []
  },
 ui: {
    pusat: { province: '', village: '', deviceLoc: 'all', ticketFilter: 'open', ruleEditing: false, announceTarget: 'ALL', announceVillages: [], announceRegency: '', announceDraft: { title: '', body: '', priority: 'INFO', expiresInHours: '72' } }, lastKey: null, tracking: null, tileProgress: null,
    menu: null, modal: null, residentSearch: '', residentFilter: 'all', incidentFilter: 'active', auditSearch: '',
    alarm: { severity: 'SIAGA', target: 'ALL', message: '', waterLevelCm: '', note: '' }
  }
};
const D = state.data;

const ownVillageId = () => state.session?.villageIds?.[0] || D.villages[0]?.id || '';
const villageName = id => D.villages.find(v => v.id === id)?.name || '—';
const rosterRows = () => Object.values(D.rosters).flat().map(r => ({ ...r, id: r.residentId }));
const sortedByPriority = rows => rows.slice().sort((a, b) =>
  (PRIO_RANK[a.priority?.color] ?? 9) - (PRIO_RANK[b.priority?.color] ?? 9) || (b.priority?.score || 0) - (a.priority?.score || 0));

/* ------------------------------------------------------------ Komponen */
function badge(text, tone = 'gray', plain = false) { return `<span class="badge ${tone}${plain ? ' plain' : ''}">${esc(text)}</span>`; }

function pageHead(title, sub = '', actions = '') {
  return `<div class="page-head"><div><span class="eyebrow">${esc(scopeLabel())}</span><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
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
  const openTickets = D.tickets.filter(t => t.status !== 'RESOLVED');
  const banner = ops.length
    ? callout({ tone: 'red', icon: 'signal', title: `${ops.length} operasi sedang berjalan`, text: 'Siaga dan Awas dikendalikan JAGA Desa dan JAGA Rescue. Pusat memantau dan menerima informasinya secara langsung.', actions: `<a class="btn outline sm" href="#/desa">Lihat desa</a>` })
    : callout({ tone: 'blue', icon: 'shield', title: 'Tidak ada operasi aktif', text: 'Seluruh wilayah dalam kondisi pemantauan normal.' });
  const provinces = provinceList().map(name => {
    const vs = D.villages.filter(v => v.province === name);
    return { name, villages: vs.length, residents: D.residents.filter(r => vs.some(v => v.id === r.villageId)).length, ops: ops.filter(o => vs.some(v => v.id === o.villageId)).length };
  });
  const recentOps = D.opsAll.slice(0, 5);
  const tone = openTickets.some(t => t.priority === 'TINGGI') ? 'red' : openTickets.length ? 'orange' : '';
  return `${pageHead('Ringkasan JAGA Pusat', 'Cakupan wilayah, persediaan kalung, dan kendala teknis yang menunggu penanganan Pusat.')}
    <div class="stack">${banner}
    <div class="kpis">
      ${kpi({ icon: 'map', label: 'Provinsi', value: c.provinces ?? 0, hint: `${D.villages.length} desa terdaftar` })}
      ${kpi({ icon: 'users', label: 'Warga terdaftar', value: c.residents ?? 0, hint: `${c.vulnerableResidents ?? 0} kelompok rentan` })}
      ${kpi({ icon: 'device', label: 'Kalung aktif', value: `${c.devicesOnline ?? 0}/${c.devicesTotal ?? 0}`, hint: `${c.devicesLowBattery ?? 0} baterai rendah`, tone: 'blue' })}
      ${kpi({ icon: 'alert', label: 'Kendala teknis', value: openTickets.length, hint: `${c.ticketsInProgress ?? 0} sedang diproses`, tone })}
      ${kpi({ icon: 'signal', label: 'Operasi aktif', value: ops.length, hint: 'Informasi dari Desa dan Rescue', tone: ops.length ? 'orange' : '' })}
    </div>
    ${D.weather?.current ? `<div class="card" style="background:var(--green-50); border:1px solid var(--green-200); padding:16px; margin-bottom:16px;"><b>Cuaca Terkini (Open-Meteo)</b><div style="margin-top:8px; display:flex; gap:16px;"><div class="fact"><small>Suhu</small><b>${D.weather.current.temperature_2m}°C</b></div><div class="fact"><small>Curah Hujan</small><b>${D.weather.current.precipitation} mm</b></div></div></div>` : ''}
    <div class="grid two">
      ${card({ title: 'Kendala teknis menunggu', sub: 'Hanya dapat diselesaikan JAGA Pusat', actions: `<a class="btn outline sm" href="#/kendala">Lihat semua</a>`, flush: true, body: openTickets.length ? `<div class="list">${openTickets.slice(0, 5).map(t => `<div class="row-item"><span class="row-icon ${t.priority === 'TINGGI' ? 'red' : t.priority === 'SEDANG' ? 'orange' : ''}">${icon('alert')}</span><div class="grow"><b>${esc(t.title)}</b><small>${esc(t.villageName || t.reporterName || 'Rescue')} · ${esc(TICKET_CAT[t.category] || t.category)} · ${esc(timeAgo(t.createdAt))}</small></div>${ticketStatusBadge(t.status)}</div>`).join('')}</div>` : empty('Tidak ada kendala', 'Semua laporan dari Desa dan Rescue sudah ditangani.', 'check') })}
      ${card({ title: 'Persediaan kalung', sub: 'Dari gudang Pusat ke desa', actions: `<a class="btn outline sm" href="#/kalung">Kelola</a>`, body: `<div class="op-facts" style="padding:0"><div class="fact"><small>Gudang Pusat</small><b>${c.devicesWarehouse ?? 0}</b></div><div class="fact"><small>Stok di desa</small><b>${c.devicesInVillageStock ?? 0}</b></div><div class="fact"><small>Terdaftar</small><b>${c.devicesRegistered ?? 0}</b></div></div>` })}
    </div>
    <div class="grid two">
      ${card({ title: 'Cakupan wilayah', sub: 'Provinsi, desa, dan warga terdaftar', flush: true, body: provinces.length ? tableWrap(['Provinsi', 'Desa', 'Warga'], provinces.map(p => `<tr><td><b>${esc(p.name)}</b></td><td>${p.villages}</td><td>${p.residents}</td></tr>`)) : empty('Belum ada wilayah', '', 'map') })}
      ${card({ title: 'Operasi aktif', sub: 'Desa dengan alarm Siaga atau Awas', flush: true, body: ops.length ? operationsTable(ops) : empty('Belum ada operasi aktif', 'Operasi dibuka JAGA Desa saat alarm Siaga atau Awas dibunyikan.', 'shield') })}
    </div>
    ${card({ title: 'Status desa dan sinkron', sub: 'Desa dianggap tidak aktif bila tidak ada sinyal dari gateway atau kalung selama 24 jam', flush: true, body: villageStatusTable() })}
    ${card({ title: 'Hasil penanganan', sub: 'Seluruh kejadian dalam cakupan', body: outcomeFacts(D.overview?.outcomes) })}
    ${card({ title: 'Riwayat operasi terbaru', flush: true, body: recentOps.length ? tableWrap(['Desa', 'Tingkat', 'Dibuka', 'Status'], recentOps.map(o => `<tr><td><b>${esc(o.villageName || villageName(o.villageId))}</b><small>${esc(o.disasterType)}</small></td><td>${severityBadge(o.severity)}</td><td>${esc(dateTime(o.openedAt))}</td><td>${o.closedAt ? badge('Selesai', 'gray') : badge('Berjalan', 'red')}</td></tr>`)) : empty('Belum ada riwayat operasi') })}
    </div>`;
}
function villageStatusTable() {
  const rows = D.villageStat?.villages || [];
  if (!rows.length) return empty('Belum ada data status desa', '', 'building');
  return tableWrap(['Desa', 'Status', 'Sinkron terakhir', 'Gateway', 'Kalung'], rows.filter(v => !/fixture/i.test(v.name)).map(v => `<tr>
    <td><b>${esc(v.name)}</b><small>${esc([v.regency, v.province].filter(Boolean).join(', '))}</small></td>
    <td>${badge(v.status === 'ACTIVE' ? 'Aktif' : 'Tidak aktif', v.status === 'ACTIVE' ? 'green' : 'red')}</td>
    <td>${v.lastSyncAt ? `${esc(timeAgo(v.lastSyncAt))}<small>${esc(dateTime(v.lastSyncAt))}</small>` : '<small>Belum pernah</small>'}</td>
    <td>${v.gateways.online}/${v.gateways.total}</td><td>${v.devices.online}/${v.devices.total}</td></tr>`));
}
function outcomeFacts(o) {
  if (!o) return empty('Belum ada data', '', 'check');
  const f = (label, value) => `<div class="fact"><small>${label}</small><b>${value ?? 0}</b></div>`;
  return `<div class="op-facts" style="padding:0; display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 16px;">${f('Dievakuasi', o.EVACUATED)}${f('Dinyatakan aman', o.SAFE)}${f('Tidak ditemukan', o.NOT_FOUND)}${f('Tidak terjangkau', o.UNREACHABLE)}${f('Masih ditangani', o.OPEN)}</div>`;
}
const TICKET_CAT = { KALUNG: 'Kalung', GATEWAY: 'Gateway', AKUN: 'Akun', DATA: 'Data wilayah', APLIKASI: 'Aplikasi', LAINNYA: 'Lainnya' };
const TICKET_STATUS = { OPEN: ['Menunggu', 'red'], IN_PROGRESS: ['Diproses', 'orange'], RESOLVED: ['Selesai', 'green'] };
const ticketStatusBadge = status => badge((TICKET_STATUS[status] || [status])[0], (TICKET_STATUS[status] || ['', 'gray'])[1]);
const provinceList = () => [...new Set(D.villages.map(v => v.province).filter(Boolean))].sort();
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
  const f = state.ui.pusat;
  const rows = villageStats().filter(s => !f.province || s.village.province === f.province);
  const filterBar = `<div class="toolbar"><label class="field inline">Provinsi<select data-bind="pusat.province"><option value="">Semua provinsi</option>${provinceList().map(p => `<option value="${esc(p)}" ${f.province === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
    <small>${rows.length} desa${f.province ? ` di ${esc(f.province)}` : ' di seluruh provinsi'}</small></div>`;
const body = rows.length ? tableWrap(['Desa', 'Warga', 'Kalung online', 'Baterai', 'Sinyal terakhir', 'Alarm', 'Kejadian', 'Status', 'Aksi'], rows.map(s => {
    const vs = (D.villageStat?.villages || []).find(v => v.villageId === s.village.id);
    const status = s.operation ? badge('Operasi aktif', 'red') : s.devices && s.online < s.devices ? badge('Perlu perhatian', 'orange') : badge('Normal', 'green');
    const head = s.village.headName ? `<small><b>Kades ${esc(s.village.headName)}</b>${s.village.headPhone ? ` · ${esc(s.village.headPhone)}` : ''}</small>` : '<small>Kades belum diisi</small>';
    return `<tr><td><b>${esc(s.village.name)}</b><small>${esc([s.village.regency, s.village.province].filter(Boolean).join(', '))}${s.village.population ? ` · ${s.village.population.toLocaleString('id-ID')} jiwa` : ''}</small>${head}</td>
      <td>${s.residents}</td><td>${s.online}/${s.devices}</td><td>${s.lowBattery ? badge(`${s.lowBattery} kalung`, 'orange') : '—'}</td>
      <td>${esc(timeAgo(vs?.lastSyncAt || s.lastSeen))}</td><td>${vs ? tierBadge(vs.tier) : '—'}</td><td>${s.incidents ? badge(`${s.incidents} aktif`, 'red') : '—'}</td><td>${status}</td>
      <td class="row-actions"><button class="btn outline sm" data-action="open-modal" data-modal="village-head" data-id="${esc(s.village.id)}">Kontak</button></td></tr>`;
  })) : empty('Tidak ada desa pada filter ini', 'Pilih provinsi lain.', 'building');
  return `${pageHead('Monitoring desa', 'Status setiap desa: warga terdaftar, kondisi kalung, operasi berjalan, dan kontak kepala desa (dikelola JAGA Pusat).')}
    <div class="stack">
    ${card({ title: 'Peta wilayah', sub: 'Titik warga, zona bahaya, titik kumpul, dan tim', flush: true, extra: 'has-legend', body: `${filterBar}<div class="map-box" data-map="overview"></div>${mapLegend('overview')}` })}
    ${card({ title: 'Seluruh desa', sub: `${rows.length} desa dalam cakupan`, flush: true, body })}</div>`;
}

function residentFilterFn(row) {
  const f = state.ui.residentFilter, cats = row.vulnerabilityCategories || [];
  if (f === 'DISABILITAS' || f === 'LANSIA' || f === 'IBU_HAMIL') return cats.includes(f);
  if (f === 'LAINNYA') return !cats.some(c => ['DISABILITAS', 'LANSIA', 'IBU_HAMIL'].includes(c));
  return true;
}
function residentsView({ canAdd, withVillage }) {
  const term = state.ui.residentSearch.trim().toLowerCase();
  const f = state.ui.pusat;
  const villageOf = r => D.villages.find(v => v.id === r.villageId);
  const rows = D.residents.filter(residentFilterFn)
    .filter(r => !term || [r.fullName, r.phone, r.address, ...(r.vulnerabilities || []).map(v => v.name)].some(x => String(x ?? '').toLowerCase().includes(term)))
    .filter(r => !withVillage || ((!f.province || villageOf(r)?.province === f.province) && (!f.village || r.villageId === f.village)));
  const filters = [['all', 'Semua'], ['DISABILITAS', 'Disabilitas'], ['LANSIA', 'Lansia'], ['IBU_HAMIL', 'Ibu hamil'], ['LAINNYA', 'Lainnya']];
  const head = ['Warga', 'Kelompok rentan', 'Kemampuan evakuasi', 'Kalung', ...(canAdd ? [''] : [])];
  const rowCells = r => `<td><div class="cell-flex"><span class="avatar-sm">${esc(initials(r.fullName))}</span><div><b>${esc(r.fullName)}</b><small>${r.age != null ? `${r.age} th` : 'Usia —'} · ${r.livesAlone ? 'tinggal sendiri' : 'bersama keluarga'}</small></div></div></td>
      <td>${groupChips(r.vulnerabilities)}</td>
      <td>${abilityBadge(r.evacuationAbility)}${r.timeCriticalMedical ? `<small><b>Medis mendesak</b></small>` : ''}</td>
      <td>${r.deviceId ? badge(r.deviceId, 'green', true) : badge('Belum berkalung', 'gray', true)}</td>${canAdd ? `<td class="row-actions"><button class="btn outline sm" data-action="edit-resident" data-id="${esc(r.id)}">Ubah</button> <button class="btn outline sm danger-text" data-action="delete-resident" data-id="${esc(r.id)}" data-name="${esc(r.fullName)}">Nonaktifkan</button></td>` : ''}`;
  const rowHtml = r => `<tr class="group-member">${rowCells(r)}</tr>`;
  let body;
  if (!rows.length) body = empty('Tidak ada warga yang cocok', 'Ubah kata kunci atau filter.', 'users');
  else if (withVillage) {
    const groups = new Map();
    for (const r of rows) groups.set(r.villageId, [...(groups.get(r.villageId) || []), r]);
    const ordered = [...groups.entries()].sort((a, b) => villageName(a[0]).localeCompare(villageName(b[0]), 'id'));
    body = `<div class="table-wrap"><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>${ordered.map(([id, list]) => {
      const v = D.villages.find(x => x.id === id);
      return `<tbody class="resident-group"><tr class="group-row" data-action="toggle-group" data-village="${esc(id)}" role="button" tabindex="0" aria-expanded="true"><td colspan="${head.length}"><div class="cell-flex"><span class="chev"></span><div><b>${esc(villageName(id))}</b><small>${esc([v?.district, v?.regency, v?.province].filter(Boolean).join(', '))} · ${list.length} warga</small></div></div></td></tr>${list.map(rowHtml).join('')}</tbody>`;
    }).join('')}</table></div>`;
  } else body = tableWrap(head, rows.map(rowHtml));
  const regionFilters = withVillage ? `<label class="field inline">Provinsi<select data-bind="pusat.province"><option value="">Semua</option>${provinceList().map(p => `<option value="${esc(p)}" ${f.province === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
      <label class="field inline">Desa<select data-bind="pusat.village"><option value="">Semua desa</option>${D.villages.filter(v => !f.province || v.province === f.province).map(v => `<option value="${esc(v.id)}" ${f.village === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>` : '';
  return `${pageHead(canAdd ? 'Data warga' : 'Data warga terdaftar', canAdd ? 'Warga kelompok rentan yang berkalung JAGA. Data ini menentukan prioritas saat bencana.' : 'Pandangan baca saja, dikelompokkan menurut wilayah. Pembaruan data dilakukan oleh JAGA Desa.',
      canAdd ? `<button class="btn primary" data-action="open-modal" data-modal="resident">${icon('plus')} Tambah warga</button>` : '')}
    ${card({ title: `${rows.length} warga`, sub: `Dari ${D.residents.length} warga terdaftar`, flush: true, body: `
      <div class="toolbar"><label class="search">${icon('search')}<input type="search" placeholder="Cari nama, telepon, atau kelompok…" value="${esc(state.ui.residentSearch)}" data-bind="residentSearch" data-keep-focus="1"></label>
      ${regionFilters}
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
  const draft = D.ruleSets.find(x => x.status === 'DRAFT');
  const levelTone = { PANTAU: 'green', SEGERA_TINJAU: 'yellow', RESPONS_CEPAT: 'orange', DARURAT: 'red' };
  const levelName = { PANTAU: 'Hijau · Pantau', SEGERA_TINJAU: 'Kuning · Segera ditinjau', RESPONS_CEPAT: 'Oranye · Respons cepat', DARURAT: 'Merah · Darurat' };
  const ruleAction = draft
    ? `<button class="btn primary" data-action="rules-edit">${icon('sliders')} ${state.ui.pusat.ruleEditing ? 'Tutup edit' : 'Edit aturan'}</button>`
    : set ? `<button class="btn primary" data-action="rules-revise" data-id="${esc(set.id)}">${icon('sliders')} Revisi aturan</button>` : '';
  const head = pageHead('Aturan prioritas penyelamatan', 'Aturan aktif tidak diubah langsung. Klik Edit aturan untuk membuka formulir draf; formulir menutup sendiri setelah draf disimpan atau diaktifkan.', ruleAction);
  if (!set) return `${head}${card({ title: 'Belum ada aturan aktif', body: empty('Belum ada rule set berstatus aktif', 'Publikasikan satu rule set agar prioritas dapat dihitung.', 'sliders') })}`;
  const thresholds = D.thresholds.slice().sort((a, b) => a.minScore - b.minScore);
  const rules = (set.rules || []).slice().sort((a, b) => a.displayOrder - b.displayOrder);
  const cond = r => `${esc(r.factorKey)} · ${esc(r.operator)} ${esc(Array.isArray(r.comparisonValue) ? r.comparisonValue.join(', ') : r.comparisonValue ?? '')}`;
  let editor = '', draftPreview = '';
  if (draft) {
    const dr = D.draftRules, dRules = (dr?.rules || []).slice().sort((a, b) => a.displayOrder - b.displayOrder);
    const dTh = Object.fromEntries((D.draftThresholds || []).map(t => [t.level, t.minScore]));
    if (state.ui.pusat.ruleEditing) {
      const th = [['SEGERA_TINJAU', 'Kuning'], ['RESPONS_CEPAT', 'Oranye'], ['DARURAT', 'Merah']];
      editor = `<form data-form="rules-save" data-id="${esc(draft.id)}">${card({
        title: `Draf revisi v${draft.version}`, sub: 'Ubah bobot lalu simpan. Aturan baru berlaku setelah diaktifkan.',
        actions: `<div class="page-actions"><button type="button" class="btn outline sm" data-action="rules-discard" data-id="${esc(draft.id)}">Buang draf</button><button type="submit" class="btn primary sm">Simpan draf</button><button type="button" class="btn lime sm" data-action="open-modal" data-modal="rules-activate" data-id="${esc(draft.id)}">Aktifkan…</button></div>`,
        flush: true,
        body: `<div class="form-grid" style="padding:20px 22px 0;border-bottom:1px solid var(--line-soft)"><label class="field wide">Nama draf aturan<input name="ruleName" value="${esc(draft.name)}" maxlength="160"></label><label class="field wide">Deskripsi (opsional)<input name="ruleDescription" value="${esc(draft.description || '')}" maxlength="2000" placeholder="mis. Standar operasional respons banjir 2026"></label></div>
        <div class="toolbar"><b style="font-size:13px">Ambang warna (skor minimum)</b>${th.map(([lv, lb]) => `<label class="field inline">${lb}<input type="number" name="th_${lv}" value="${esc(dTh[lv] ?? '')}" step="1" min="0" max="999" style="width:90px"></label>`).join('')}<small>Hijau = di bawah ambang kuning</small></div>
        ${dRules.length ? tableWrap(['Faktor', 'Poin', 'Penjelasan yang tampil di Rescue', 'Aktif'], dRules.map((r, i) => `<tr><td><b>${esc(FACTOR_LABEL[r.factorKey] || r.factorKey)}</b><small>${cond(r)}</small></td>
          <td><input class="cell-input num" type="number" name="score_${i}" value="${esc(r.scoreDelta)}" step="1" min="-100" max="100"></td>
          <td><input class="cell-input" type="text" name="text_${i}" value="${esc(r.explanation)}" maxlength="500"></td>
          <td><input type="checkbox" name="active_${i}" ${r.active ? 'checked' : ''}></td></tr>`)) : empty('Draf belum berisi aturan', 'Buang draf lalu buat revisi dari aturan aktif.', 'sliders')}` })}</form>`;
    } else {
      draftPreview = card({ title: `Draf revisi v${draft.version}`, sub: `${dRules.length} aturan · belum aktif`,
        actions: badge('Menunggu aktivasi', 'yellow'),
        body: `<p>Klik <b>Edit aturan</b> untuk membuka formulir perubahan. Draf hanya berlaku setelah diaktifkan.</p>${dRules.length ? `<div class="chips">${dRules.slice(0, 6).map(r => badge(`${esc(FACTOR_LABEL[r.factorKey] || r.factorKey)} · ${r.scoreDelta > 0 ? '+' : ''}${r.scoreDelta}`, r.scoreDelta >= 25 ? 'red' : r.scoreDelta >= 10 ? 'orange' : 'gray', true)).join('')}</div>${dRules.length > 6 ? `<small>${esc(`… dan ${dRules.length - 6} aturan lain`)}</small>` : ''}` : ''}` });
    }
  }
  return `${head}
    <div class="stack">${editor}${draftPreview}
    <div class="grid two-even">
      ${card({ title: set.name, sub: `Versi ${set.version} · ${set.ruleCount ?? rules.length} aturan`, actions: badge('Aktif', 'green'), body: `<p>${esc(set.description || '')}</p>${draft && !state.ui.pusat.ruleEditing ? '<small>Draf revisi sedang disusun.</small>' : ''}` })}
      ${card({ title: 'Ambang warna aktif', sub: 'Skor total warga menentukan warna', body: thresholds.length ? `<div class="list">${thresholds.map(t => `<div class="row-item" style="padding-left:0;padding-right:0"><span class="dot ${levelTone[t.level]}"></span><div class="grow"><b>${esc(levelName[t.level] || t.level)}</b></div><b>${t.minScore} ke atas</b></div>`).join('')}</div>` : empty('Ambang belum diatur') })}
    </div>
    ${card({ title: 'Daftar aturan aktif', sub: 'Poin ditambahkan bila kondisi terpenuhi', flush: true, body: tableWrap(['Faktor', 'Poin', 'Penjelasan'], rules.map(r => `<tr><td><b>${esc(FACTOR_LABEL[r.factorKey] || r.factorKey)}</b><small>${cond(r)}</small></td><td>${badge(`${r.scoreDelta > 0 ? '+' : ''}${r.scoreDelta}`, r.scoreDelta >= 25 ? 'red' : r.scoreDelta >= 10 ? 'orange' : 'gray', true)}</td><td>${esc(r.explanation)}</td></tr>`)) })}
    </div>`;
}

function viewPusatAkun() {
  const body = D.accounts.length ? tableWrap(['Pengguna', 'Peran', 'Wilayah', 'Status', 'Login terakhir', ''], D.accounts.map(a => `<tr>
    <td><div class="cell-flex"><span class="avatar-sm">${esc(initials(a.displayName))}</span><div><b>${esc(a.displayName)}</b><small>${esc(a.email)}</small></div></div></td>
    <td>${badge({ PUSAT: 'JAGA Pusat', DESA: 'JAGA Desa', RESCUE: 'JAGA Rescue' }[a.role] || a.role, a.role === 'PUSAT' ? 'blue' : a.role === 'DESA' ? 'green' : 'orange')}<small>${esc(a.title || '')}</small></td>
    <td>${a.role === 'PUSAT' || !a.villageIds ? 'Seluruh wilayah' : esc((a.villageIds || []).map(villageName).join(', ') || '—')}</td>
    <td>${badge(a.active ? 'Aktif' : 'Nonaktif', a.active ? 'green' : 'gray')}</td><td>${esc(a.lastLoginAt ? timeAgo(a.lastLoginAt) : 'Belum pernah')}</td>
    <td class="row-actions">${a.id ? `<button class="btn outline sm" data-action="open-modal" data-modal="account-edit" data-id="${esc(a.id)}">Ubah</button> ` : ''}${a.id && a.email !== state.session?.email ? `<button class="btn outline sm danger-text" data-action="account-delete" data-id="${esc(a.id)}" data-name="${esc(a.displayName)}">Hapus</button>` : '<small>Akun Anda</small>'}</td></tr>`)) : empty('Belum ada akun', '', 'shield');
  return `${pageHead('Akun & akses', 'Akun JAGA Desa dan JAGA Rescue dibuat oleh JAGA Pusat dan dibatasi pada wilayahnya.',
    `<button class="btn primary" data-action="open-modal" data-modal="account">${icon('plus')} Buat akun</button>`)}
    ${card({ title: `${D.accounts.length} akun`, flush: true, body })}`;
}

function reportsTable() {
  if (!D.reports.length) return empty('Belum ada laporan pasca-operasi', 'Tim Rescue mengirimnya setelah operasi selesai.', 'file');
  return tableWrap(['Operasi', 'Tim', 'Ringkasan', 'Hasil', 'Dikirim'], D.reports.map(r => `<tr>
    <td><b>${esc(r.villageName || '—')}</b><small>${esc(r.operationOpenedAt ? dateTime(r.operationOpenedAt) : '')}</small></td>
    <td>${esc(r.organizationName || '—')}<small>${esc(r.teamName || r.authorName || '')}</small></td><td style="max-width:360px">${r.summary?.length > 90 ? `<details><summary style="cursor:pointer; color:var(--green-600); font-weight:600">${esc(r.summary.substring(0, 90))}... <span style="font-size:11px; margin-left:4px">(tampilkan)</span></summary><div style="margin-top:6px; color:var(--ink); font-weight:normal">${esc(r.summary)}</div></details>` : esc(r.summary)}</td>
    <td><small>Ditemukan ${r.foundCount} · Dievakuasi ${r.evacuatedCount} · Tidak ditemukan ${r.notFoundCount} · Tidak terjangkau ${r.unreachableCount}${r.distanceKm != null ? ` · ${r.distanceKm} km` : ''}</small></td>
    <td>${esc(dateTime(r.createdAt))}</td></tr>`));
}
function viewPusatLaporan() {
  const ops = D.opsAll;
  const opsBody = ops.length ? tableWrap(['Desa', 'Jenis', 'Tingkat', 'Area', 'Tinggi air', 'Dibuka', 'Ditutup'], ops.map(o => `<tr>
    <td><b>${esc(o.villageName || villageName(o.villageId))}</b></td><td>${esc(o.disasterType)}</td><td>${severityBadge(o.severity)}</td><td>${esc(o.areaLabel)}</td>
    <td>${o.waterLevelCm != null ? `${o.waterLevelCm} cm` : '—'}</td><td>${esc(dateTime(o.openedAt))}</td><td>${o.closedAt ? esc(dateTime(o.closedAt)) : badge('Berjalan', 'red')}</td></tr>`)) : empty('Belum ada riwayat operasi', '', 'file');
  const incBody = D.incidents.length ? tableWrap(['Warga', 'Desa', 'Jenis', 'Status', 'Dilaporkan'], D.incidents.map(i => `<tr>
    <td><b>${esc(i.ownerName || '—')}</b></td><td>${esc(villageName(i.villageId))}</td><td>${esc(i.disasterType || '—')}</td><td>${statusBadge(i.status)}</td><td>${esc(dateTime(i.createdAt))}</td></tr>`)) : empty('Belum ada kejadian', '', 'file');
  return `${pageHead('Laporan', 'Rekap operasi dan kejadian untuk evaluasi dan pelaporan kebijakan.', `<button class="btn outline" data-action="print-report">${icon('download')} Cetak / simpan PDF</button>`)}
    <div class="stack">
    ${card({ title: 'Hasil penanganan', sub: 'Seluruh kejadian', body: outcomeFacts(D.overview?.outcomes) })}
    ${card({ title: 'Laporan pasca-operasi Rescue', sub: `${D.reports.length} laporan`, flush: true, body: reportsTable() })}
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

/* ------------------------------------------------ Kalung dan kendala (Pusat) */
function viewPusatKalung() {
  const c = D.overview?.counters || {};
  const f = state.ui.pusat.deviceLoc;
  const all = D.devices.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const rows = all.filter(d => f === 'gudang' ? !d.villageId : f === 'desa' ? !!d.villageId : true);
  const body = rows.length ? tableWrap(['Kalung', 'Lokasi', 'Warga', 'Baterai', 'Koneksi', 'Status', ''], rows.map(d => `<tr>
    <td><b class="nowrap">${esc(d.id)}</b><small>${esc(d.model || '')}${d.firmwareVersion ? ` · fw ${esc(d.firmwareVersion)}` : ''}</small></td>
    <td>${d.villageId ? esc(villageName(d.villageId)) : badge('Gudang Pusat', 'blue')}</td>
    <td>${esc(d.residentName || '—')}</td><td>${batteryCell(d.battery)}</td>
    <td>${d.status === 'STOCK' ? '<small>Belum dipakai</small>' : d.online ? badge('Online', 'green') : badge('Offline', 'red')}</td>
    <td>${badge({ ASSIGNED: 'Terpasang', STOCK: 'Stok', MAINTENANCE: 'Perawatan', LOST: 'Hilang', RETIRED: 'Dipensiunkan' }[d.status] || d.status, 'gray', true)}</td>
    <td class="row-actions">${d.residentId ? '<small>Terpasang pada warga</small>' : `<button class="btn outline sm" data-action="open-modal" data-modal="device-dist" data-id="${esc(d.id)}">Distribusikan</button>`}</td></tr>`)) : empty('Belum ada kalung', 'Daftarkan kalung ke gudang Pusat lalu distribusikan ke desa.', 'device');
  const seg = [['all', 'Semua'], ['gudang', 'Gudang Pusat'], ['desa', 'Di desa']];
  return `${pageHead('Kalung', 'Ketersediaan kalung bersumber dari Pusat: didaftarkan ke gudang, didistribusikan ke desa, lalu dipasang Desa pada warga.',
    `<button class="btn primary" data-action="open-modal" data-modal="device-new">${icon('plus')} Daftarkan kalung</button>`)}
    <div class="stack"><div class="kpis">
      ${kpi({ icon: 'device', label: 'Terdaftar', value: c.devicesRegistered ?? all.length, hint: 'Seluruh kalung JAGA' })}
      ${kpi({ icon: 'building', label: 'Gudang Pusat', value: c.devicesWarehouse ?? 0, hint: 'Siap didistribusikan', tone: 'blue' })}
      ${kpi({ icon: 'truck', label: 'Stok di desa', value: c.devicesInVillageStock ?? 0, hint: 'Menunggu dipasang Desa' })}
      ${kpi({ icon: 'signal', label: 'Aktif', value: `${c.devicesOnline ?? 0}/${c.devicesTotal ?? 0}`, hint: 'Terpasang dan online', tone: 'green' })}
    </div>
    ${card({ title: `${rows.length} kalung`, flush: true, body: `<div class="toolbar"><div class="segmented">${seg.map(([v, l]) => `<button class="${f === v ? 'active' : ''}" data-action="device-loc" data-value="${v}">${l}</button>`).join('')}</div></div>${body}` })}
    </div>`;
}

function viewPusatKendala() {
  const f = state.ui.pusat.ticketFilter;
  const rows = D.tickets.filter(t => f === 'all' || (f === 'open' ? t.status === 'OPEN' : f === 'proses' ? t.status === 'IN_PROGRESS' : t.status === 'RESOLVED'));
  const count = key => D.tickets.filter(t => key === 'open' ? t.status === 'OPEN' : key === 'proses' ? t.status === 'IN_PROGRESS' : key === 'done' ? t.status === 'RESOLVED' : true).length;
  const seg = [['open', 'Menunggu'], ['proses', 'Diproses'], ['done', 'Selesai'], ['all', 'Semua']];
  const body = rows.length ? tableWrap(['Kendala', 'Pelapor', 'Prioritas', 'Status', 'Dilaporkan', ''], rows.map(t => `<tr>
    <td><b>${esc(t.title)}</b><small>${esc(TICKET_CAT[t.category] || t.category)}${t.description ? ` · ${esc(t.description)}` : ''}</small>${t.resolutionNote ? `<small><b>Penanganan:</b> ${esc(t.resolutionNote)}</small>` : ''}</td>
    <td>${esc(t.reporterName || '—')}<small>${esc(t.villageName || (t.reporterRole === 'RESCUE' ? 'JAGA Rescue' : '—'))}</small></td>
    <td>${badge({ TINGGI: 'Tinggi', SEDANG: 'Sedang', RENDAH: 'Rendah' }[t.priority] || t.priority, t.priority === 'TINGGI' ? 'red' : t.priority === 'SEDANG' ? 'orange' : 'gray')}</td>
    <td>${ticketStatusBadge(t.status)}</td><td>${esc(timeAgo(t.createdAt))}<small>${esc(dateTime(t.createdAt))}</small></td>
    <td class="row-actions">${t.status === 'OPEN' ? `<button class="btn outline sm" data-action="ticket-status" data-id="${esc(t.id)}" data-status="IN_PROGRESS">Mulai tangani</button> ` : ''}${t.status !== 'RESOLVED' ? `<button class="btn primary sm" data-action="open-modal" data-modal="ticket-resolve" data-id="${esc(t.id)}">Selesaikan</button>` : ''}</td></tr>`)) : empty('Tidak ada kendala pada filter ini', 'Laporan dari Desa dan Rescue akan muncul di sini.', 'check');
  return `${pageHead('Kendala teknis', 'Hal teknis yang tidak dapat diselesaikan Desa atau Rescue dan hanya dapat ditangani JAGA Pusat. Penanganan Siaga dan insiden tetap di Desa dan Rescue.')}
    ${card({ title: `${rows.length} kendala`, flush: true, body: `<div class="toolbar"><div class="segmented">${seg.map(([v, l]) => `<button class="${f === v ? 'active' : ''}" data-action="ticket-filter" data-value="${v}">${l} ${count(v)}</button>`).join('')}</div></div>${body}` })}`;
}

function viewPusatPengumuman() {
  const f = state.ui.pusat;
  const target = f.announceTarget;
  const villages = D.villages;
  const targetField = `<div class="field wide"><b style="font-size:13px">Tujuan</b>
    <div class="segmented" style="margin-top:8px">
      <button type="button" class="${target === 'ALL' ? 'active' : ''}" data-bind-target="ALL">${icon('building')} Semua desa</button>

      <button type="button" class="${target === 'VILLAGES' ? 'active' : ''}" data-bind-target="VILLAGES">${icon('check')} Desa tertentu</button>
    </div></div>`;
  const regencyNames = [...new Set(villages.map(v => v.regency).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
  const targetPicker = target === 'VILLAGES'
    ? `<fieldset class="wide"><legend>Desa tujuan <small>${f.announceVillages.length} dipilih</small></legend><div class="checks" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${villages.length ? villages.map(v => `<label class="check"><input type="checkbox" data-toggle-village="${esc(v.id)}" ${f.announceVillages.includes(v.id) ? 'checked' : ''}><span>${esc(v.name)}<small>${esc(v.regency || v.province || '')}${v.headName ? ` · Kades ${esc(v.headName)}` : ''}</small></span></label>`).join('') : '<small>Belum ada desa terdaftar.</small>'}</div></fieldset>`
    : target === 'REGENCY'
      ? `<fieldset class="wide"><legend>Kabupaten tujuan</legend><div class="form-grid"><label class="field">Kabupaten<select data-bind="pusat.announceRegency"><option value="">Pilih kabupaten…</option>${regencyNames.length ? regencyNames.map(r => `<option value="${esc(r)}" ${f.announceRegency === r ? 'selected' : ''}>${esc(r)}</option>`).join('') : '<option value="">Belum ada desa terdaftar</option>'}</select></label></div><small>Pengumuman dikirim ke <b>semua desa</b> di kabupaten tersebut.</small></fieldset>`
      : '';
  const targetLabel = target === 'ALL' ? 'Kirim ke semua desa dan Rescue' : target === 'REGENCY' ? 'Kirim ke semua desa se-Kabupaten' : `Kirim ke ${f.announceVillages.length} desa`;
  const form = `<form data-form="announcement" class="card-body" style="display:grid;gap:16px">
    <label class="field wide">Judul<input name="title" data-keep="title" required minlength="3" maxlength="160" value="${esc(f.announceDraft.title)}" placeholder="mis. Uji kesiapsiagaan kalung bulan ini"></label>
    <label class="field wide">Isi pengumuman<textarea name="body" data-keep="body" required minlength="3" maxlength="2000" placeholder="Pesan untuk JAGA Desa dan JAGA Rescue di tujuan">${esc(f.announceDraft.body)}</textarea></label>
    <div class="form-grid"><label class="field">Prioritas<select name="priority" data-keep="priority"><option value="INFO" ${f.announceDraft.priority === 'INFO' ? 'selected' : ''}>Informasi</option><option value="PENTING" ${f.announceDraft.priority === 'PENTING' ? 'selected' : ''}>Penting (tampil di banner)</option></select></label>
      <label class="field">Berlaku (jam)<input name="expiresInHours" data-keep="expiresInHours" type="number" min="1" max="2160" value="${esc(f.announceDraft.expiresInHours)}"></label></div>
    ${targetField}${targetPicker}
    <button class="btn primary" type="submit">${icon('bell')} ${targetLabel}</button></form>`;
  const list = D.announcements.length ? `<div class="list">${D.announcements.map(a => `<div class="row-item"><span class="row-icon ${a.priority === 'PENTING' ? 'orange' : ''}">${icon('bell')}</span><div class="grow"><b>${esc(a.title)}</b><small>${esc(a.body)}</small><small>${esc(timeAgo(a.createdAt))}${a.expiresAt ? ` · berlaku sampai ${esc(dateTime(a.expiresAt))}` : ''}</small></div>${a.villageIds?.length ? badge(`${a.villageIds.length} desa`, 'blue', true) : badge('Semua desa', 'green', true)}${a.priority === 'PENTING' ? badge('Penting', 'orange') : badge('Info', 'gray', true)}<button class="btn outline sm danger-text" data-action="announcement-delete" data-id="${esc(a.id)}">Hapus</button></div>`).join('')}</div>` : empty('Belum ada pengumuman', '', 'bell');
  return `${pageHead('Pengumuman', 'Kirim pembaruan operasional ke seluruh desa atau ke desa tertentu. Data kepala desa diisi JAGA Pusat dan dipakai sebagai penerima kontak. Pengumuman penting tampil sebagai banner.')}
    <div class="grid two">${card({ title: 'Pengumuman baru', flush: true, body: form })}${card({ title: 'Riwayat pengumuman', sub: `${D.announcements.length} pengumuman`, flush: true, body: list })}</div>`;
}

function viewPusatPlatform() {
  const info = D.platformInfo, gov = D.governanceInfo;
  if (!info || !gov) return `${pageHead('Platform & data', 'Pengaturan global dan tata kelola data sensitif.')}${card({ title: 'Belum dapat dimuat', body: empty('Data belum tersedia', 'Muat ulang halaman.', 'building') })}`;
  const st = info.settings;
  const toggle = (name, label, hint) => `<label class="check"><input type="checkbox" name="${name}" ${st[name] ? 'checked' : ''}><span>${label}<small>${hint}</small></span></label>`;
  const form = `<form data-form="platform" class="card-body" style="display:grid;gap:16px">
    <div class="form-grid"><label class="field">Batas kalung dianggap offline (menit)<input name="device_offline_minutes" type="number" min="1" max="1440" value="${esc(st.device_offline_minutes)}"></label>
      <label class="field">Masa berlaku alarm (menit)<input name="alert_expiry_minutes" type="number" min="5" max="10080" value="${esc(st.alert_expiry_minutes)}"></label></div>
    <fieldset><legend>Yang boleh dilihat JAGA Rescue saat operasi aktif</legend><div class="checks" style="grid-template-columns:1fr">
      ${toggle('rescue_view_medical', 'Catatan medis dan kebutuhan penanganan', 'Agar petugas tahu cara memperlakukan warga (mis. insulin, alat bantu).')}
      ${toggle('rescue_view_contacts', 'Kontak darurat dan telepon warga', 'Untuk menghubungi pendamping atau keluarga.')}
      ${toggle('rescue_view_gps', 'Posisi GPS kalung langsung', 'Bila dimatikan, Rescue hanya melihat lokasi rumah.')}</div></fieldset>
    <button class="btn primary" type="submit">Simpan pengaturan</button></form>`;
  const access = Object.entries(gov.rescueAccess30d || {});
  return `${pageHead('Platform & data', 'Pengaturan global, versi sistem, dan tata kelola data sensitif. NIK tidak ditampilkan di antarmuka mana pun.')}
    <div class="stack"><div class="grid two">${card({ title: 'Pengaturan platform', flush: true, body: form })}
      <div class="stack">${card({ title: 'Versi dan penyebaran', body: `<div class="op-facts" style="padding:0"><div class="fact"><small>Aplikasi</small><b>v${esc(info.version.app)}</b></div><div class="fact"><small>Penyimpanan</small><b>${esc(info.version.storage)}</b></div><div class="fact"><small>Node</small><b>${esc(info.version.node)}</b></div></div>` })}
        ${card({ title: 'Versi firmware kalung', sub: 'Sebaran pembaruan di lapangan', flush: true, body: info.firmware.length ? tableWrap(['Versi', 'Jumlah kalung'], info.firmware.map(f => `<tr><td><b>${esc(f.version)}</b></td><td>${f.count}</td></tr>`)) : empty('Belum ada kalung') })}</div></div>
    <div class="grid two">${card({ title: 'Persetujuan pendataan', body: `<div class="op-facts" style="padding:0"><div class="fact"><small>Warga terdaftar</small><b>${gov.consent.total}</b></div><div class="fact"><small>Sudah berpersetujuan</small><b>${gov.consent.consented}</b></div><div class="fact"><small>NIK tersimpan</small><b>${gov.nikStored}</b></div></div>` })}
      ${card({ title: 'Akses Rescue ke data warga (30 hari)', flush: true, body: access.length ? `<div class="list">${access.map(([k, v]) => `<div class="row-item"><div class="grow"><b>${esc(String(k).replaceAll('_', ' '))}</b></div><b>${v}</b></div>`).join('')}${gov.recentAccess.slice(0, 5).map(r => `<div class="row-item"><div class="grow"><small>${esc(dateTime(r.at))}</small><small>${esc(r.summary)}</small></div></div>`).join('')}</div>` : empty('Belum ada akses', 'Setiap pembukaan data warga oleh Rescue tercatat di sini.', 'shield') })}</div></div>`;
}

/** Desa dan Rescue melapor ke Pusat. */
function viewKendalaLapor() {
  const sel = (name, items, chosen) => `<select name="${name}">${items.map(([v, l]) => `<option value="${v}" ${v === chosen ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const form = `<form data-form="ticket" class="card-body" style="display:grid;gap:16px">
    <div class="form-grid"><label class="field">Kategori${sel('category', Object.entries(TICKET_CAT))}</label>
      <label class="field">Prioritas${sel('priority', [['RENDAH', 'Rendah'], ['SEDANG', 'Sedang'], ['TINGGI', 'Tinggi: mengganggu respons']], 'SEDANG')}</label></div>
    <label class="field">Judul<input name="title" required minlength="5" maxlength="160" placeholder="mis. Kalung pengganti belum diterima"></label>
    <label class="field">Uraian<textarea name="description" maxlength="2000" placeholder="Apa yang terjadi, sejak kapan, dan apa yang dibutuhkan dari Pusat"></textarea></label>
    <button type="submit" class="btn primary">${icon('plus')} Kirim ke JAGA Pusat</button></form>`;
  const mine = D.tickets;
  const list = mine.length ? `<div class="list">${mine.map(t => `<div class="row-item"><span class="row-icon ${t.status === 'RESOLVED' ? '' : t.priority === 'TINGGI' ? 'red' : 'orange'}">${icon('alert')}</span><div class="grow"><b>${esc(t.title)}</b><small>${esc(TICKET_CAT[t.category] || t.category)} · ${esc(timeAgo(t.createdAt))}</small>${t.resolutionNote ? `<small><b>Pusat:</b> ${esc(t.resolutionNote)}</small>` : ''}</div>${ticketStatusBadge(t.status)}</div>`).join('')}</div>` : empty('Belum ada laporan', 'Laporkan hal teknis yang hanya dapat diselesaikan JAGA Pusat.', 'check');
  return `${pageHead('Kendala teknis', 'Laporkan hal teknis yang tidak bisa Anda selesaikan sendiri, misalnya kalung rusak atau habis, gateway, akun, atau data wilayah. Pusat menanggapi di sini.')}
    <div class="grid two">${card({ title: 'Laporkan kendala', sub: 'Dikirim ke JAGA Pusat', flush: true, body: form })}
      ${card({ title: 'Laporan Anda', sub: `${mine.length} laporan`, flush: true, body: list })}</div>`;
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

const BOARD_TONE = { BANTUAN: 'red', TIDAK_TERJANGKAU: 'red', TIDAK_DITEMUKAN: 'orange', MENUNGGU: 'yellow', AMAN: 'green', NORMAL: 'gray' };
function viewDesaStatus() {
  const b = D.board;
  if (!b) return `${pageHead('Status warga', 'Status tiap penerima manfaat saat alarm dibunyikan.')}${card({ title: 'Papan status', body: empty('Papan belum dapat dimuat', 'Periksa koneksi lalu muat ulang.', 'check') })}`;
  const c = b.counts || {};
  const order = ['BANTUAN', 'TIDAK_TERJANGKAU', 'TIDAK_DITEMUKAN', 'MENUNGGU', 'AMAN', 'NORMAL'];
  const body = b.rows.length ? tableWrap(['Warga', 'Keadaan', 'Alarm', 'Kalung', ''], b.rows.map(r => `<tr>
    <td><b>${esc(r.residentName)}</b></td>
    <td>${badge(r.stateLabel, BOARD_TONE[r.state] || 'gray')}${r.assistanceAt ? `<small>Tombol ditekan ${esc(timeAgo(r.assistanceAt))}</small>` : ''}</td>
    <td>${r.alarmSeverity ? `${severityBadge(r.alarmSeverity)}<small>${esc(timeAgo(r.alarmAt))}</small>` : '<small>—</small>'}</td>
    <td>${esc(r.deviceId)}<small>${r.online ? 'online' : 'offline'} · ${r.battery ?? '—'}%</small></td>
    <td class="row-actions">${r.incidentId && ['BANTUAN', 'TIDAK_DITEMUKAN', 'TIDAK_TERJANGKAU'].includes(r.state) ? `<button class="btn primary sm" data-action="open-modal" data-modal="dispatch" data-id="${esc(r.incidentId)}">Kerahkan tim</button>` : ''}</td></tr>`)) : empty('Belum ada penerima manfaat berkalung', '', 'users');
  return `${pageHead('Status warga', 'Keadaan tiap penerima manfaat setelah alarm: belum merespons, meminta bantuan (tombol kalung ditekan), atau aman dan dievakuasi (dikonfirmasi JAGA Rescue).')}
    <div class="stack"><div class="kpis">${order.filter(k => k !== 'NORMAL').map(k => kpi({ icon: k === 'AMAN' ? 'check' : k === 'MENUNGGU' ? 'clock' : 'alert', label: b.labels[k], value: c[k] ?? 0, tone: k === 'BANTUAN' && c[k] ? 'red' : k === 'AMAN' ? 'green' : '' })).join('')}</div>
    ${card({ title: `${b.rows.length} penerima manfaat`, sub: 'Diperbarui langsung saat kalung merespons', flush: true, body })}</div>`;
}

function viewDesaBeranda() {
  const c = D.overview?.counters || {};
  const op = D.operations[0];
  const items = attentionItemsDesa();
  const assigned = D.devices.filter(d => d.residentId);
  const banner = op ? operationCard(op) : callout({ tone: 'blue', icon: 'shield', title: 'Tidak ada operasi berjalan', text: 'Operasi dibuka otomatis saat Anda membunyikan alarm Siaga atau Awas untuk seluruh desa.', actions: `<a class="btn primary sm" href="#/alarm">${icon('bell')} Buka alarm</a>` });
  const breakdown = D.safety?.breakdown || [];
  const emergencyCard = `<div class="emergency-card"><div><b>Sinyal darurat</b><small>Satu tombol: seluruh kalung di desa berbunyi dan bergetar, operasi Rescue dibuka. Pakai hanya saat bencana terjadi.</small></div><button class="btn danger" data-action="open-modal" data-modal="emergency">${icon('bell')} Kirim sinyal darurat</button></div>`;
  const w = D.weather?.current;
  const weatherCard = w ? `<div class="card" style="background:var(--green-50); border:1px solid var(--green-200); padding:16px;"><b>Cuaca Terkini (Open-Meteo)</b><div style="margin-top:8px; display:flex; gap:16px;"><div class="fact"><small>Suhu</small><b>${w.temperature_2m}°C</b></div><div class="fact"><small>Curah Hujan</small><b>${w.precipitation} mm</b></div></div></div>` : '';
  return `${pageHead('Beranda desa', 'Kondisi terkini warga rentan, kalung, dan kejadian di desa Anda.')}
    <div class="stack">${weatherCard}${emergencyCard}${banner}
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
  const levels = [['WASPADA', 'Waspada', 'Peringatan dini. Tidak membuka operasi Rescue.'], ['SIAGA', 'Siaga', 'Bersiap mengungsi. Membuka operasi Rescue.'], ['AWAS', 'Awas', 'Segera mengungsi. Membuka operasi Rescue.']];
  const devices = D.devices.filter(d => d.residentId);
  const opens = ['SIAGA', 'AWAS'].includes(a.severity) && a.target === 'ALL';
  const history = D.alerts.slice(0, 8);
  const form = `<form data-form="alarm-review" class="card-body" style="display:grid;gap:18px">
    <div><div class="field"><span>Tingkat peringatan</span></div><div class="levels" style="margin-top:8px">
      ${levels.map(([v, l, h]) => `<button type="button" class="level ${v} ${a.severity === v ? 'active' : ''}" data-action="severity" data-value="${v}"><b>${l}</b><small>${h}</small></button>`).join('')}</div></div>
    <label class="field">Target<select data-bind="alarm.target"><option value="ALL" ${a.target === 'ALL' ? 'selected' : ''}>Seluruh kalung di desa</option><optgroup label="Kelompok">${[['DISABILITAS', 'Penyandang disabilitas'], ['LANSIA', 'Lansia'], ['IBU_HAMIL', 'Ibu hamil']].map(([code, label]) => `<option value="GROUP:${code}" ${a.target === `GROUP:${code}` ? 'selected' : ''}>${label}</option>`).join('')}</optgroup><optgroup label="Satu kalung">${devices.map(d => `<option value="${esc(d.id)}" ${a.target === d.id ? 'selected' : ''}>${esc(d.residentName || d.ownerName || d.id)} · ${esc(d.id)}</option>`).join('')}</optgroup></select></label>
    <div class="form-grid"><label class="field">Tinggi air terpantau (cm)<input type="number" min="0" max="2000" placeholder="mis. 100 untuk 1 meter" value="${esc(a.waterLevelCm)}" data-bind="alarm.waterLevelCm"><small>Masukkan berdasarkan pengamatan lapangan.</small></label>
      <label class="field">Catatan pengamatan<input type="text" maxlength="300" placeholder="mis. Sungai naik, titik rendah tergenang" value="${esc(a.note)}" data-bind="alarm.note"></label></div>
    <label class="field">Pesan untuk warga<textarea placeholder="${esc(DEFAULT_MESSAGE[a.severity])}" data-bind="alarm.message">${esc(a.message)}</textarea><small>Kosongkan untuk memakai pesan standar.</small></label>
    ${opens ? callout({ tone: 'yellow', icon: 'signal', title: 'Alarm ini membuka operasi Rescue', text: 'JAGA Rescue akan melihat warga berkalung di desa selama operasi berjalan.' }) : ''}
    <button type="submit" class="btn primary block">${icon('bell')} Tinjau & aktifkan alarm</button></form>`;
  const historyBody = history.length ? `<div class="list">${history.map(h => `<div class="row-item"><span class="row-icon ${SEVERITY[h.severity]?.[1] || ''}">${icon('bell')}</span><div class="grow"><b>${esc(h.message || h.target)}</b><small>${esc(h.target)} · ${esc(timeAgo(h.createdAt))}</small></div>${severityBadge(h.severity)}<small>${h.receipts?.acknowledged ?? 0}/${h.receipts?.total ?? 0} dikonfirmasi</small></div>`).join('')}</div>` : empty('Belum ada alarm', '', 'bell');
  return `${pageHead('Alarm & operasi', 'Bunyikan alarm ke kalung warga setelah kondisi diverifikasi. Anda yang paling tahu keadaan lapangan.')}
    <div class="grid two">${card({ title: 'Aktifkan alarm', sub: 'Dikonfirmasi manusia sebelum dikirim', flush: true, body: form })}
      <div class="stack">${D.operations.length ? D.operations.map(operationCard).join('') : ''}${card({ title: 'Riwayat alarm', flush: true, body: historyBody })}${card({ title: 'Laporan pasca-operasi Rescue', sub: `${D.reports.length} laporan`, flush: true, body: reportsTable() })}</div></div>`;
}

function viewDesaTitik() {
  const rows = D.shelters.filter(s => s.active);
  const body = rows.length ? tableWrap(['Titik evakuasi', 'Kapasitas', 'Koordinat', 'Catatan', ''], rows.map(s => `<tr>
    <td><b>${esc(s.name)}</b><small>${esc(s.address || '')}</small></td><td>${s.capacity ?? '—'}</td>
    <td><small>${num(s.latitude) !== null ? `${Number(s.latitude).toFixed(5)}, ${Number(s.longitude).toFixed(5)}` : '—'}</small></td>
    <td><small>${esc(s.accessibilityNotes || '')}</small></td>
    <td class="row-actions"><button class="btn outline sm" data-action="open-modal" data-modal="shelter" data-id="${esc(s.id)}">Ubah</button> <button class="btn outline sm" data-action="shelter-delete" data-id="${esc(s.id)}">Hapus</button></td></tr>`))
    : empty('Belum ada titik evakuasi', 'Tambahkan tempat warga berkumpul atau mengungsi saat bencana.', 'shield');
  return `${pageHead('Titik evakuasi', 'Tempat warga berkumpul atau mengungsi. Anda yang paling tahu lokasi yang aman; perbarui bila kondisi berubah.',
    `<button class="btn primary" data-action="open-modal" data-modal="shelter">${icon('plus')} Tambah titik</button>`)}
    <div class="stack">${callout({ tone: 'yellow', icon: 'info', title: 'Pastikan lokasi aman dari banjir', text: 'Periksa apakah bangunan berlantai atas dan tidak terendam pada banjir terdahulu. Titik ini dipakai untuk rute dan rekomendasi Rescue.' })}
    ${card({ title: 'Daftar titik evakuasi', sub: `${rows.length} titik`, flush: true, body })}</div>`;
}

function viewDesaKalung() {
  const rows = D.devices.slice().sort((a, b) => (a.online ? 1 : 0) - (b.online ? 1 : 0) || (num(a.battery) ?? 100) - (num(b.battery) ?? 100));
  const assigned = rows.filter(d => d.residentId);
  const body = rows.length ? tableWrap(['Kalung', 'Warga', 'Baterai', 'Koneksi', 'Posisi GPS', 'Terakhir aktif', 'Status'], rows.map(d => `<tr>
    <td><b>${esc(d.id)}</b><small>${esc(d.model || '')} ${d.firmwareVersion ? `· fw ${esc(d.firmwareVersion)}` : ''}</small></td>
    <td>${esc(d.residentName || (d.status === 'STOCK' ? 'Stok' : '—'))}</td><td>${batteryCell(d.battery)}</td>
    <td>${d.online ? badge('Online', 'green') : badge('Offline', 'red')}</td>
    <td>${d.locationAt ? `${esc(timeAgo(d.locationAt))}<small>${d.locationAccuracyMeters ? `±${Math.round(d.locationAccuracyMeters)} m` : 'tanpa akurasi'}</small>` : '<small>Belum ada fix</small>'}</td><td>${esc(timeAgo(d.lastSeenAt))}</td>
    <td>${badge({ ASSIGNED: 'Terpasang', STOCK: 'Stok', MAINTENANCE: 'Perawatan', LOST: 'Hilang', RETIRED: 'Dipensiunkan' }[d.status] || d.status, 'gray', true)}</td></tr>`)) : empty('Belum ada kalung', '', 'device');
  const stockNote = callout({ tone: 'blue', icon: 'device', title: 'Kalung disediakan JAGA Pusat', text: `${rows.length - assigned.length} kalung stok di desa ini. Butuh kalung tambahan, pengganti, atau ada yang rusak? Laporkan ke Pusat.`, actions: `<a class="btn primary sm" href="#/kendala">Lapor kendala</a>` });
  return `${pageHead('Kesehatan kalung', 'Pantau baterai dan koneksi. Kalung offline tidak dapat menerima alarm.')}
    <div class="stack">${stockNote}<div class="kpis">
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
  if (role === 'rescue' && ['ASSIGNED', 'EN_ROUTE', 'ARRIVED'].includes(i.status)) {
    buttons.push(`<button class="btn outline sm" data-action="incident-status" data-id="${esc(i.id)}" data-status="NOT_FOUND">Tidak ditemukan</button>`, `<button class="btn outline sm" data-action="incident-status" data-id="${esc(i.id)}" data-status="UNREACHABLE">Tidak terjangkau</button>`);
  }
  if (role === 'desa' && isActive(i)) buttons.push(`<button class="btn outline sm" data-action="open-modal" data-modal="dispatch" data-id="${esc(i.id)}">Kerahkan tim</button>`);
  if (role !== 'rescue' && isActive(i)) buttons.push(`<button class="btn outline sm" data-action="incident-status" data-id="${esc(i.id)}" data-status="CLOSED">Tutup</button>`);
  return buttons.join(' ') || '<small>—</small>';
}
function viewIncidents(title, sub) {
  const all = D.incidents;
  const rows = state.ui.incidentFilter === 'active' ? all.filter(isActive) : all;
  const body = rows.length ? tableWrap(['Warga', 'Status', 'Kejadian', 'Tim', 'Aksi'], rows.map(i => `<tr>
    <td><div class="cell-flex"><span class="avatar-sm">${esc(initials(i.ownerName))}</span><div><b>${esc(i.ownerName || '—')}</b><small>${esc(timeAgo(i.createdAt))} · ${esc(dateTime(i.createdAt))}</small></div></div></td>
    <td>${statusBadge(i.status)}</td><td>${esc(i.disasterType || '—')}<small>${esc(i.description || '')}</small></td>
    <td>${(i.teams || []).map(t => esc(t.name)).join(', ') || '<small>Belum ada tim</small>'}</td><td><button class="btn outline sm" data-action="open-modal" data-modal="sos" data-id="${esc(i.id)}">Detail</button> ${incidentActions(i)}</td></tr>`)) : empty(state.ui.incidentFilter === 'active' ? 'Tidak ada kejadian aktif' : 'Belum ada kejadian', 'SOS dari kalung akan muncul di sini.', 'alert');
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
  if (!rows.length) return empty('Belum ada operasi aktif', 'Data warga baru terbuka setelah JAGA Desa membunyikan alarm Siaga atau Awas.', 'shield');
  return `<div class="prio-list">${rows.map((r, i) => {
    const color = r.priority?.color || 'green';
    return `<article class="prio-card ${color}"><div class="prio-top"><b><span class="prio-rank ${color}">${i + 1}</span>${esc(r.fullName)}</b>${prioBadge(r.priority)}</div>
      <div class="prio-meta">${esc((r.vulnerabilities || []).map(v => v.name).join(', ') || '—')} ${r.livesAlone ? ' · <b>tinggal sendiri</b>' : ''}</div>
      <div class="prio-meta"><b>${esc((ABILITY[r.evacuationAbility] || ['Kemampuan evakuasi belum dinilai'])[0])}</b>${r.timeCriticalMedical ? ' · <b>medis mendesak</b>' : ''}</div>
      <div class="why"><b>Mengapa ${esc(PRIO_NAME[color])} · skor ${esc(r.priority?.score ?? '—')}</b>${esc(topReasons(r) || 'Belum ada aturan prioritas aktif.')}</div>
      <div class="prio-foot"><button class="btn primary sm" data-action="open-route" data-resident="${esc(r.residentId)}">${icon('route')} Rute</button>${r.positionSource === 'GPS' ? '<span class="badge green plain">GPS kalung</span>' : '<span class="badge gray plain">Lokasi rumah</span>'}${r.activeIncident ? `<span class="badge red">SOS · ${esc((STATUS[r.activeIncident.status] || [''])[0])}</span>` : ''}${r.device && !r.device.online ? '<span class="badge red">Kalung offline</span>' : ''}${(r.contacts || []).slice(0, 1).map(c => `<span class="badge gray plain">${esc(c.name)} · ${esc(c.phone)}</span>`).join('')}</div></article>`;
  }).join('')}</div>`;
}
function viewRescuePrioritas() {
  const rows = sortedByPriority(rosterRows());
  const count = c => rows.filter(r => r.priority?.color === c).length;
  const ops = D.operations;
  const banner = ops.length
    ? callout({ tone: 'red', icon: 'signal', title: `${ops.length} operasi aktif: ${ops.map(o => `${o.villageName} (${o.areaLabel})`).join('; ')}`, text: 'Komandan menentukan tim dan urutan di lapangan. Prioritas berikut adalah rekomendasi sistem beserta alasannya.' })
    : callout({ tone: 'blue', icon: 'shield', title: 'Belum ada operasi aktif', text: 'Anda akan diberi tahu saat JAGA Desa membunyikan alarm Siaga atau Awas.' });
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
  return tableWrap(['Prioritas', 'Warga', 'Kebutuhan evakuasi', 'Kontak darurat', 'Kalung', 'Status', ''], sortedByPriority(rows).map(r => `<tr title="${esc(topReasons(r, 6))}">
    <td>${prioBadge(r.priority)}<small>skor ${esc(r.priority?.score ?? '—')}</small></td>
    <td><b>${esc(r.fullName)}</b><small>${esc(r.ageGroup ? r.ageGroup.toLowerCase() : '')}${r.livesAlone ? ' · tinggal sendiri' : ''}${r.phone ? ` · <span class="nowrap">${esc(r.phone)}</span>` : ''}</small></td>
    <td>${groupChips(r.vulnerabilities)}<small>${esc(r.evacuationNotes || r.mobilityNotes || '')}</small>${r.medicalNotes ? `<small><b>Medis:</b> ${esc(r.medicalNotes)}</small>` : ''}</td>
    <td>${(r.contacts || []).map(c => `${esc(c.name)} · <span class="nowrap">${esc(c.phone)}</span>`).join('<br>') || '—'}</td>
    <td>${r.device?.online ? badge('Online', 'green') : badge('Offline', 'red')}<small>${esc(r.device?.battery ?? '—')}%</small></td>
    <td>${r.activeIncident ? badge(`SOS · ${(STATUS[r.activeIncident.status] || [''])[0]}`, 'red') : badge('Belum ada SOS', 'gray', true)}</td>
    <td><button class="btn outline sm" data-action="open-route" data-resident="${esc(r.residentId)}">${icon('route')} Rute</button></td></tr>`));
}
function viewRescueOperasi() {
  if (!D.operations.length) return `${pageHead('Operasi', 'Daftar warga berkalung di area operasi aktif.')}${card({ title: 'Belum ada operasi aktif', body: empty('Belum ada operasi aktif', 'Operasi dibuka otomatis saat JAGA Desa membunyikan alarm Siaga/Awas. Akses data warga dicabut saat operasi ditutup.', 'shield') })}`;
  return `${pageHead('Operasi', 'Daftar warga berkalung di area terdampak. Akses ini tercatat dan berakhir saat operasi ditutup.')}
    <div class="stack">${D.operations.map(op => card({
      title: `${op.villageName} · ${(SEVERITY[op.severity] || [op.severity])[0]}`,
      sub: `${op.disasterType} · area: ${op.areaLabel} · dibuka ${dateTime(op.openedAt)}${op.waterLevelCm != null ? ` · tinggi air ${op.waterLevelCm} cm` : ''}`,
      actions: `<button class="btn outline sm" data-action="op-tiles" data-village="${esc(op.villageId)}">${icon('map')} Unduh peta offline</button> <button class="btn outline sm" data-action="op-pack" data-id="${esc(op.id)}">${icon('download')} Unduh paket offline</button>`,
      flush: true, body: `${op.note ? `<div style="padding:14px 20px"><small>Catatan Desa: ${esc(op.note)}</small></div>` : ''}${rosterTable(D.rosters[op.id] || [])}` })).join('')}</div>`;
}
function viewRescueTugas() { return viewIncidents('Tugas lapangan', 'Perbarui status penanganan warga. Perubahan langsung terlihat oleh JAGA Desa.'); }

function viewRescueLaporan() {
  const ops = (D.opsAll || []).slice().sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt)));
  const teams = D.teams.filter(t => t.organizationId === state.session?.organizationId);
  const opOptions = ops.map(o => `<option value="${esc(o.id)}">${esc(o.villageName || villageName(o.villageId))} · ${esc(dateTime(o.openedAt))} · ${o.closedAt ? 'selesai' : 'berjalan'}</option>`).join('');
  const form = ops.length ? `<form data-form="report" class="card-body" style="display:grid;gap:16px">
    <div class="form-grid"><label class="field">Operasi<select name="operationId" required>${opOptions}</select></label>
      <label class="field">Tim<select name="teamId"><option value="">Seluruh tim organisasi</option>${teams.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></label></div>
    <div class="form-grid"><label class="field">Warga ditemukan<input name="foundCount" type="number" min="0" value="0"></label><label class="field">Dievakuasi<input name="evacuatedCount" type="number" min="0" value="0"></label>
      <label class="field">Tidak ditemukan<input name="notFoundCount" type="number" min="0" value="0"></label><label class="field">Tidak terjangkau<input name="unreachableCount" type="number" min="0" value="0"></label></div>
    <label class="field">Jarak tempuh tim (km)<input name="distanceKm" type="number" min="0" step="0.1" placeholder="opsional"></label>
    <label class="field">Ringkasan operasi<textarea name="summary" required minlength="10" maxlength="4000" placeholder="Area yang disisir, hambatan di lapangan, dan hal yang perlu dicatat"></textarea></label>
    <button class="btn primary" type="submit">${icon('file')} Kirim laporan</button></form>` : empty('Belum ada operasi', 'Laporan dapat dibuat setelah JAGA Desa membuka operasi.', 'file');
  return `${pageHead('Laporan operasi', 'Ringkasan pasca-operasi untuk JAGA Desa dan JAGA Pusat: hasil pencarian, hambatan, dan jarak tempuh.')}
    <div class="stack">${card({ title: 'Laporan baru', flush: true, body: form })}${card({ title: 'Laporan organisasi Anda', sub: `${D.reports.length} laporan`, flush: true, body: reportsTable() })}</div>`;
}

const TEAM_COLORS = ['#1d4ed8', '#7c3aed', '#0f766e', '#b45309', '#be185d', '#4d7c0f'];
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
  const tr = state.tracking;
  const tracking = D.teams.filter(t => t.organizationId === mine).length ? card({ title: 'Pelacakan jalur', sub: 'Posisi perangkat ini dikirim berkala dan digambar sebagai area yang sudah disisir', body: tr
    ? `<div class="sos-head" style="background:var(--green-50);color:var(--green-800)">${icon('route')}<b>Pelacakan aktif untuk ${esc(D.teams.find(t => t.id === tr.teamId)?.name || 'tim')}</b></div><p style="margin-top:10px;color:var(--muted)">${tr.count} titik terkirim${tr.lastAt ? ` · terakhir ${esc(timeAgo(tr.lastAt))}` : ''}${tr.error ? ` · ${esc(tr.error)}` : ''}</p><button class="btn outline" style="margin-top:12px" data-action="track-stop">Hentikan pelacakan</button>`
    : `<div class="form-grid"><label class="field">Tim<select id="trackTeam">${D.teams.filter(t => t.organizationId === mine).map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></label><div style="align-self:end"><button class="btn primary" data-action="track-start">${icon('route')} Mulai pelacakan jalur</button></div></div><small>Butuh izin lokasi di perangkat. Jejak hanya terlihat oleh tim yang melayani desa operasi.</small>` }) : '';
  return `${pageHead('Tim', 'Status dan posisi tim di wilayah operasi. Anda dapat mengubah status tim organisasi Anda.')}<div class="stack">${tracking}${card({ title: `${D.teams.length} tim`, flush: true, body })}</div>`;
}

/* ---------------------------------------------------------------- Peta */
const MAP_LEGENDS = {
  rescue: [['red', 'Merah'], ['orange', 'Oranye'], ['yellow', 'Kuning'], ['green', 'Hijau'], ['blue', 'Titik kumpul'], ['gray', 'Zona bahaya'], ['blue', 'Jejak tim (area tersisir)']],
  village: [['red', 'SOS aktif'], ['green', 'Warga'], ['blue', 'Titik kumpul'], ['gray', 'Zona bahaya']],
  overview: [['red', 'SOS aktif'], ['green', 'Warga'], ['blue', 'Titik kumpul'], ['gray', 'Zona bahaya']]
};
function mapLegend(kind) {
  return `<div class="map-legend">${(MAP_LEGENDS[kind] || MAP_LEGENDS.village).map(([c, l]) => `<span><i class="dot ${c}"></i>${l}</span>`).join('')}<span><i class="dot blue" style="border-radius:3px"></i>Tim · Gateway</span></div>`;
}
const zoneColor = risk => (risk >= 5 ? '#c8372d' : risk >= 4 ? '#e2700d' : '#d9a406');
const pinIcon = (color, sos = false) => L.divIcon({ className: '', html: `<div class="pin ${color}${sos ? ' sos' : ''}"></div>`, iconSize: [20, 20], iconAnchor: [10, 10] });
const squareIcon = (kind, text) => L.divIcon({ className: '', html: `<div class="pin-sq ${kind}">${text}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] });

/* Peta dasar: jalan (Esri World Street Map, lebih detail jalannya) atau citra satelit (Esri World Imagery). Pilihan diingat di peramban. */
function addBaseLayers(map) {
  const layers = {
    jalan: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Peta &copy; Esri, OpenStreetMap' }),
    satelit: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Citra &copy; Esri, Maxar, Earthstar Geographics' })
  };
  let current = 'jalan';
  try { if (localStorage.getItem('jaga-basemap') === 'satelit') current = 'satelit'; } catch { /* penyimpanan tidak tersedia */ }
  layers[current].addTo(map);
  const control = L.control({ position: 'topright' });
  control.onAdd = () => {
    const box = L.DomUtil.create('div', 'basemap-switch');
    const render = () => { box.innerHTML = `<button type="button" class="${current === 'jalan' ? 'on' : ''}" data-base="jalan">Peta</button><button type="button" class="${current === 'satelit' ? 'on' : ''}" data-base="satelit">Satelit</button>`; };
    render();
    L.DomEvent.disableClickPropagation(box);
    box.addEventListener('click', event => {
      const next = event.target.dataset?.base;
      if (!next || next === current) return;
      map.removeLayer(layers[current]); layers[next].addTo(map); current = next; render();
      try { localStorage.setItem('jaga-basemap', next); } catch { /* abaikan */ }
    });
    return box;
  };
  if (state.config?.inariskWmsUrl) {
    const risk = L.tileLayer.wms(state.config.inariskWmsUrl, { layers: state.config.inariskWmsLayers || '', format: 'image/png', transparent: true, opacity: 0.55, attribution: 'InaRISK BNPB' });
    const rb = L.control({ position: 'topright' });
    rb.onAdd = () => {
      const btn = L.DomUtil.create('button', 'basemap-risk');
      btn.type = 'button'; btn.textContent = 'Risiko banjir';
      L.DomEvent.disableClickPropagation(btn);
      btn.addEventListener('click', () => { if (map.hasLayer(risk)) { map.removeLayer(risk); btn.classList.remove('on'); } else { risk.addTo(map); btn.classList.add('on'); } });
      return btn;
    };
    rb.addTo(map);
  }
  control.addTo(map);
}

function mountMaps() {
  $$('[data-map]').forEach(el => {
    if (!window.L) { el.innerHTML = '<div class="map-fallback"><div><b>Peta tidak dapat dimuat</b><br><small>Periksa koneksi internet.</small></div></div>'; return; }
    const kind = el.dataset.map, map = L.map(el, { scrollWheelZoom: false });
    addBaseLayers(map);
    const bounds = [], source = D.map || { residents: [], hazardZones: [], shelters: [], teams: [], gateways: [], incidents: [] };
    const add = (lat, lng) => { if (num(lat) !== null && num(lng) !== null) bounds.push([Number(lat), Number(lng)]); };

    const keepVillage = id => kind !== 'overview' || !state.ui.pusat.province || !id || D.villages.find(v => v.id === id)?.province === state.ui.pusat.province;
    source.hazardZones.forEach(z => {
      if (num(z.centerLatitude) === null || !keepVillage(z.villageId)) return;
      const color = zoneColor(z.riskLevel);
      L.circle([z.centerLatitude, z.centerLongitude], { radius: z.radiusMeters || 200, color, weight: 2, dashArray: '6 6', fillColor: color, fillOpacity: .13 })
        .bindTooltip(`${esc(z.name)} · risiko ${z.riskLevel}`).addTo(map);
      add(z.centerLatitude, z.centerLongitude);
    });
    if (kind === 'rescue') {
      Object.values(D.coverage || {}).forEach(cov => (cov?.teams || []).forEach((team, index) => {
        if ((team.points || []).length < 2) return;
        const color = TEAM_COLORS[index % TEAM_COLORS.length], line = team.points.map(p => [p.lat, p.lng]);
        L.polyline(line, { color, weight: 18, opacity: .18, lineCap: 'round', lineJoin: 'round' }).bindTooltip(`Area tersisir · ${esc(team.name)}`).addTo(map);
        L.polyline(line, { color, weight: 3, opacity: .9 }).addTo(map);
        line.forEach(p => add(p[0], p[1]));
      }));
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
        if (num(r.latitude) === null || !keepVillage(r.villageId)) return;
        const sos = sosByResident.has(r.id);
        L.marker([r.latitude, r.longitude], { icon: pinIcon(sos ? 'red' : 'green', sos) }).bindTooltip(esc(r.fullName)).addTo(map);
        add(r.latitude, r.longitude);
      });
    }
    source.shelters.forEach(s => { if (num(s.latitude) !== null && keepVillage(s.villageId)) { L.marker([s.latitude, s.longitude], { icon: squareIcon('shelter', 'T') }).bindTooltip(`${esc(s.name)}${s.capacity ? ` · kapasitas ${s.capacity}` : ''}`).addTo(map); add(s.latitude, s.longitude); } });
    source.teams.forEach(t => { if (num(t.latitude) !== null) { L.marker([t.latitude, t.longitude], { icon: squareIcon('team', 'R') }).bindTooltip(`${esc(t.name)} · ${esc(TEAM_STATUS[t.status] || t.status)}`).addTo(map); if (kind === 'overview') add(t.latitude, t.longitude); } });
    source.gateways.forEach(g => { if (num(g.latitude) !== null) { L.marker([g.latitude, g.longitude], { icon: squareIcon('gateway', 'G') }).bindTooltip(`${esc(g.name)} · ${g.online ? 'online' : 'offline'}`).addTo(map); if (kind === 'overview') add(g.latitude, g.longitude); } });

    if (bounds.length) map.fitBounds(bounds, { padding: [34, 34], maxZoom: 17 }); else map.setView([4.8479, 97.4728], 12);
    map.on('click', () => map.scrollWheelZoom.enable());
    state.maps.push(map);
    setTimeout(() => { if (state.maps.includes(map)) map.invalidateSize(); }, 60);
  });
}
function destroyMaps() { state.maps.forEach(m => { try { m.stop(); m.remove(); } catch { /* peta sudah dilepas */ } }); state.maps = []; }

/* --------------------------------------------------------- Rute tampilan */
const VIEWS = {
  pusat: { ringkasan: viewPusatRingkasan, desa: viewPusatDesa, warga: () => residentsView({ canAdd: false, withVillage: true }), kalung: viewPusatKalung, kendala: viewPusatKendala, pengumuman: viewPusatPengumuman, platform: viewPusatPlatform, aturan: viewPusatAturan, akun: viewPusatAkun, laporan: viewPusatLaporan, audit: viewPusatAudit },
  desa: { beranda: viewDesaBeranda, warga: viewDesaWarga, alarm: viewDesaAlarm, kalung: viewDesaKalung, kejadian: viewDesaKejadian, status: viewDesaStatus, titik: viewDesaTitik, kendala: viewKendalaLapor, peta: () => viewMapPage('village') },
  rescue: { prioritas: viewRescuePrioritas, operasi: viewRescueOperasi, tugas: viewRescueTugas, tim: viewRescueTim, laporan: viewRescueLaporan, kendala: viewKendalaLapor, peta: () => viewMapPage('rescue') }
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
  if (n.title === 'SOS') return 'SOS dari kalung';
  const match = /^ALERT_(WASPADA|SIAGA|AWAS)$/.exec(n.title || '');
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
  const queued = JagaApi.pending();
  const pill = JagaApi.net.offline ? `<span class="status-pill warn"><i></i>Offline${queued ? `<small>${queued} menunggu</small>` : ''}</span>`
    : state.error ? '<span class="status-pill bad"><i></i>Koneksi bermasalah</span>'
    : state.role === 'rescue' ? `<span class="status-pill"><i></i>Terhubung<small>${D.operations.length} operasi</small></span>`
      : state.role === 'pusat' ? '<span class="status-pill"><i></i>Terhubung</span>'
      : `<span class="status-pill"><i></i>Terhubung<small>${c.devicesOnline ?? 0}/${c.devicesTotal ?? 0} kalung</small></span>`;
  const openTicketCount = D.tickets.filter(t => t.status !== 'RESOLVED').length;
  const tabBadge = id => (id === 'kendala' && state.role === 'pusat' && openTicketCount) ? `<span class="badge-mini">${openTicketCount}</span>` : ((id === 'kejadian' || id === 'tugas') && activeIncidents) ? `<span class="badge-mini">${activeIncidents}</span>` : (id === 'operasi' && D.operations.length) ? `<span class="badge-mini">${D.operations.length}</span>` : '';
  let menu = '';
  if (state.ui.menu === 'notif') {
    const items = D.notifications.slice(0, 8);
    menu = `<div class="menu" data-menu-panel><div class="menu-head"><b>Notifikasi</b><small>${unread} belum dibaca</small></div><div class="menu-list">${items.length ? items.map(n => `<div class="menu-item"><b>${esc(notificationTitle(n))}</b><small>${esc(n.body)}</small><small>${esc(timeAgo(n.createdAt))}</small></div>`).join('') : '<div class="menu-empty">Belum ada notifikasi</div>'}</div></div>`;
  } else if (state.ui.menu === 'user') {
    menu = `<div class="menu" data-menu-panel><div class="menu-head"><b>${esc(s.displayName)}</b><small>${esc(s.email)}</small><small>${esc(config.label)} · ${esc(scopeLabel())}</small></div><a class="menu-item" href="/"><b>Halaman depan JAGA</b></a><button class="menu-item danger" data-action="logout">${icon('logout')} Keluar</button></div>`;
  }
  bar.innerHTML = `<div class="navbar-top">
      <span class="role-chip"><i></i>${esc(config.label)}</span>
      <div class="nav-actions">${pill}
        <button class="icon-btn" data-action="menu" data-menu="notif" aria-label="Notifikasi">${icon('bell')}${unread ? `<span class="count">${unread > 9 ? '9+' : unread}</span>` : ''}</button>
        <button class="avatar" data-action="menu" data-menu="user" aria-label="Akun saya">${esc(initials(s.displayName))}</button></div>${menu}</div>
    ${useSidebar ? '' : `<nav class="tabs" aria-label="Menu utama">${config.pages.map(([id, label, name]) => `<a class="tab ${id === route ? 'active' : ''}" href="#/${id}">${icon(name)}${esc(label)}${tabBadge(id)}</a>`).join('')}</nav>`}`;
  bar.classList.toggle('sidebar-mode', useSidebar);
  const side = $('#sidebar');
  $('#layout').classList.toggle('with-sidebar', useSidebar);
  side.hidden = !useSidebar;
  side.innerHTML = useSidebar
    ? `<a class="brand" href="#/${config.home}"><img src="assets/logo-mark-white.png" alt="Logo JAGA"><span class="brand-text"><b>JAGA</b><small>Siaga bersama</small></span></a>
      <div class="side-menu"><nav class="side-nav">${config.pages.map(([id, label, name]) => `<a class="side-link ${id === route ? 'active' : ''}" href="#/${id}">${icon(name)}<span>${esc(label)}</span>${tabBadge(id)}</a>`).join('')}</nav></div>`
    : '';
  const sosNow = D.incidents.filter(i => isActive(i) && i.status === 'NEW');
  const sosBar = sosNow.length ? `<div class="sos-bar" role="alert"><span class="sos-dot"></span><b>${sosNow.length} SOS baru</b><span>${sosNow.slice(0, 2).map(i => esc(i.ownerName || 'Warga')).join(', ')}${sosNow.length > 2 ? ` dan ${sosNow.length - 2} lainnya` : ''}</span><a class="btn sm" href="#/${state.role === 'rescue' ? 'tugas' : 'kejadian'}">Lihat</a></div>` : '';
  const offlineBar = JagaApi.net.offline || queued
    ? `<div class="offline-bar" role="status">${icon('signal')}<b>${JagaApi.net.offline ? 'Mode offline' : 'Menyinkronkan'}</b><span>${queued ? `${queued} perubahan tersimpan di perangkat dan akan dikirim otomatis saat koneksi kembali.` : 'Data yang tampil adalah yang terakhir dimuat. Alarm hanya dapat dibunyikan saat terhubung ke server.'}</span></div>` : '';
  const important = (D.announcements || []).filter(a => a.priority === 'PENTING' && state.role !== 'pusat').slice(0, 2);
  const noticeBar = important.map(a => `<div class="notice-bar" role="status">${icon('bell')}<b>${esc(a.title)}</b><span>${esc(a.body)}</span></div>`).join('');
  $('#demoBar').innerHTML = offlineBar + sosBar + noticeBar;
}

/* ---------------------------------------------------------------- Modal */
const modalRoot = () => $('#modalRoot');
let pendingConfirm = null;
function askConfirm({ title = 'Yakin?', sub = '', message = '', confirmLabel = 'Lanjutkan', danger = false, run: action }) {
  pendingConfirm = { action };
  openModal({ type: 'confirm', title, sub, message, confirmLabel, danger });
}
function confirmModal(payload) {
  return modalShell({ title: payload.title, sub: payload.sub,
    body: `<div class="confirm-msg">${payload.message}</div>`,
    foot: `<button class="btn outline" data-action="close-modal">Batal</button><button class="btn ${payload.danger ? 'danger' : 'primary'}" data-action="confirm-do">${esc(payload.confirmLabel)}</button>` });
}
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
    <label class="field wide">Alamat<input name="address"></label>
    <label class="field">Latitude<input name="latitude" type="number" step="any" placeholder="4.8479"></label>
    <label class="field">Longitude<input name="longitude" type="number" step="any" placeholder="97.4728"></label>
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
  const opens = ['SIAGA', 'AWAS'].includes(payload.severity) && payload.target === 'ALL';
  const groupLabel = { DISABILITAS: 'penyandang disabilitas', LANSIA: 'lansia', IBU_HAMIL: 'ibu hamil' };
  const target = payload.target === 'ALL' ? 'seluruh kalung di desa' : payload.target.startsWith('GROUP:') ? `kalung kelompok ${groupLabel[payload.target.slice(6)] || payload.target.slice(6)}` : `kalung ${payload.target}`;
  const body = `<p>Peringatan <b>${esc((SEVERITY[payload.severity] || [payload.severity])[0])}</b> akan dikirim ke <b>${esc(target)}</b>.</p>
    <div class="callout"><span class="callout-icon">${icon('info')}</span><div><b>Pesan</b><p>${esc(payload.message)}</p></div></div>
    ${opens ? callout({ tone: 'yellow', icon: 'signal', title: 'JAGA Rescue akan diberi akses otomatis', text: 'Rescue melihat warga berkalung di area ini sampai Anda menutup operasi.' }) : ''}
    <label class="check"><input type="checkbox" id="confirmCheck"><span>Saya telah memverifikasi kondisi dengan tim lapangan.</span></label>`;
  return modalShell({ title: 'Aktifkan alarm?', body, foot: `<button class="btn outline" data-action="close-modal">Batalkan</button><button class="btn danger" id="confirmSend" data-action="alarm-send" disabled>Aktifkan alarm</button>` });
}
function emergencyModal() {
  const n = D.devices.filter(d => d.residentId).length;
  const body = `<p>Kalung semua warga di desa ini (<b>${n} kalung</b>) akan <b>berbunyi, bergetar, dan menyala</b>, dan JAGA Rescue langsung diberi akses.</p>
    ${callout({ tone: 'yellow', icon: 'alert', title: 'Hanya untuk keadaan bencana', text: 'Tindakan ini tercatat di log audit dan tidak dapat ditarik kembali.' })}
    <label class="check"><input type="checkbox" id="confirmCheck"><span>Bencana sedang terjadi dan saya yakin mengirim sinyal darurat.</span></label>`;
  return modalShell({ title: 'Kirim sinyal darurat?', body, foot: `<button class="btn outline" data-action="close-modal">Batalkan</button><button class="btn danger" id="confirmSend" data-action="emergency-send" disabled>Kirim sinyal darurat</button>` });
}
/* Detail SOS: waktu, koordinat, status kalung, dan log aktivitas (mengikuti kebutuhan tim kalung). */
function gpsLabel(device) {
  if (!device || !device.locationAt) return '<span class="badge gray">Belum ada fix</span>';
  const ageMin = (Date.now() - new Date(device.locationAt).getTime()) / 60000;
  const acc = device.locationAccuracyMeters ? ` ±${Math.round(device.locationAccuracyMeters)} m` : '';
  return ageMin <= 15 ? `<span class="badge green">Fix${esc(acc)}</span> <small>${esc(timeAgo(device.locationAt))}</small>` : `<span class="badge orange">Posisi lama</span> <small>${esc(timeAgo(device.locationAt))}</small>`;
}
function sosModal(m) {
  const i = D.incidents.find(item => item.id === m.id);
  if (!i) return '';
  const rosterItem = rosterRows().find(r => r.residentId === i.residentId);
  const device = D.devices.find(d => d.id === i.deviceId) || (rosterItem?.device ? { ...rosterItem.device, locationAccuracyMeters: rosterItem.positionAccuracyMeters } : null);
  const row = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
  const body = `<div class="sos-panel">
    <div class="sos-head">${icon('alert')}<b>${esc(statusLabelOf(i))}</b>${statusBadge(i.status)}</div>
    ${row('Warga', esc(i.ownerName || '—'))}${row('Waktu', esc(dateTime(i.createdAt)) + ` <small>(${esc(timeAgo(i.createdAt))})</small>`)}
    ${row('Latitude', num(i.latitude) !== null ? Number(i.latitude).toFixed(6) : '—')}${row('Longitude', num(i.longitude) !== null ? Number(i.longitude).toFixed(6) : '—')}
    ${i.description ? row('Keterangan', esc(i.description)) : ''}
    <h3>Status perangkat</h3>
    ${row('ID perangkat', esc(i.deviceId || '—'))}${row('Koneksi', device ? (device.online ? '<span class="badge green">Online</span>' : '<span class="badge red">Offline</span>') : '—')}
    ${row('Sinyal GPS', gpsLabel(device))}${row('Baterai', device && device.battery != null ? `${esc(device.battery)}%` : '—')}
    <h3>Log aktivitas</h3><div id="sosLog" class="list"><small>Memuat…</small></div></div>`;
  const rescueRoute = state.role === 'rescue' && i.residentId ? `<button class="btn outline" data-action="open-route" data-resident="${esc(i.residentId)}">${icon('route')} Rute ke warga</button>` : '';
  const handled = isActive(i) ? `<button class="btn primary" data-action="incident-handled" data-id="${esc(i.id)}">${icon('check')} Tandai sudah ditangani</button>` : '';
  return modalShell({ title: 'Peringatan darurat', sub: 'SOS dari kalung', body, foot: `<button class="btn outline" data-action="close-modal">Tutup</button>${rescueRoute}${handled}` });
}
const statusLabelOf = i => `SOS · ${(STATUS[i.status] || [i.status])[0]}`;
async function loadSosLog(m) {
  const box = $('#sosLog');
  try {
    const detail = await JagaApi.incident(m.id);
    if (state.ui.modal !== m || !box) return;
    const items = [...(detail.history || [])].reverse().map(h => `<div class="row-item"><span class="dot ${(STATUS[h.to_status || h.status] || ['', 'gray'])[1]}"></span><div class="grow"><b>${esc((STATUS[h.to_status || h.status] || [h.to_status || h.status || 'Perubahan'])[0])}</b><small>${esc(dateTime(h.created_at))}${h.notes ? ' · ' + esc(h.notes) : ''}</small></div></div>`);
    if (!items.length) items.push(`<div class="row-item"><span class="dot red"></span><div class="grow"><b>SOS diterima dari kalung</b><small>${esc(dateTime(detail.createdAt))}</small></div></div>`);
    box.innerHTML = items.join('');
  } catch { if (box) box.innerHTML = '<small>Log tidak dapat dimuat.</small>'; }
}

/* Rute tim ke warga: jalan sebenarnya dari OSRM bila terjangkau, selain itu garis estimasi dari server. */
function routeModal(m) {
  const mine = state.session?.organizationId;
  const teams = D.teams.filter(t => t.latitude != null && (state.role !== 'rescue' || t.organizationId === mine));
  const select = teams.length ? `<label class="field">Tim asal<select data-change="route-team"><option value="">Otomatis (tim terdekat yang tersedia)</option>${teams.map(t => `<option value="${esc(t.id)}" ${m.teamId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>` : '';
  const body = `<div style="display:grid;gap:14px">${select}<div class="map-box" id="routeMap" style="height:300px"></div><div id="routeInfo"><small>Menghitung rute…</small></div></div>`;
  return modalShell({ title: 'Rute ke warga', sub: 'Posisi warga memakai GPS kalung bila segar, selain itu lokasi rumah.', body, wide: true,
    foot: `<button class="btn outline" data-action="close-modal">Tutup</button>` });
}
const minutes = seconds => `${Math.max(1, Math.round(seconds / 60))} menit`;
const km = meters => (meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`);
async function roadRoute(from, to) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 6000);
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson`;
    const data = await (await fetch(url, { signal: controller.signal })).json();
    const route = data.routes?.[0];
    if (!route) return null;
    const [a, b] = data.waypoints || [];
    return {
      path: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]), distance: route.distance, duration: route.duration,
      startGap: a?.distance ?? 0, endGap: b?.distance ?? 0
    };
  } catch { return null; } finally { clearTimeout(timer); }
}
async function loadRoute(m) {
  const info = $('#routeInfo');
  try {
    let data;
    try { data = await JagaApi.operationRoute(m.opId, m.residentId, m.teamId); }
    catch (error) { data = offlineRoute(m); if (!data) throw error; }
    if (state.ui.modal !== m) return;
    const el = $('#routeMap');
    const from = data.from, to = data.to;
    const road = window.L ? await roadRoute(from, to) : null;
    if (state.ui.modal !== m) return;
    if (window.L && el) {
      const map = state.modalMap = L.map(el, { scrollWheelZoom: false });
      addBaseLayers(map);
      L.marker([from.latitude, from.longitude], { icon: squareIcon('team', 'R') }).bindTooltip(esc(from.label)).addTo(map);
      L.marker([to.latitude, to.longitude], { icon: pinIcon('red', true) }).bindTooltip(esc(data.residentName)).addTo(map);
      const line = road ? road.path : data.fastest.path.map(p => [p.latitude, p.longitude]);
      L.polyline(line, { color: road ? '#1d4ed8' : '#6b7280', weight: 5, opacity: .85, dashArray: road ? null : '8 8' }).addTo(map);
      if (road) {
        const first = road.path[0], last = road.path[road.path.length - 1];
        L.polyline([[from.latitude, from.longitude], first], { color: '#6b7280', weight: 3, dashArray: '4 6' }).addTo(map);
        L.polyline([last, [to.latitude, to.longitude]], { color: '#6b7280', weight: 3, dashArray: '4 6' }).addTo(map);
      }
      map.fitBounds([[from.latitude, from.longitude], [to.latitude, to.longitude], ...line], { padding: [30, 30] });
      setTimeout(() => { if (state.modalMap === map) map.invalidateSize(); }, 80);
    }
    const gap = road ? Math.round(road.endGap) : 0;
    const dist = road ? road.distance + road.startGap + road.endGap : data.fastest.distanceMeters, dur = road ? road.duration + (road.startGap + road.endGap) / 1.2 : data.fastest.durationSeconds;
    const source = to.source === 'GPS' ? `GPS kalung${to.accuracyMeters ? ` ±${Math.round(to.accuracyMeters)} m` : ''}${to.positionAt ? ` · ${timeAgo(to.positionAt)}` : ''}` : 'lokasi rumah (belum ada GPS segar)';
    info.innerHTML = `<div class="route-summary"><div><b>${esc(data.residentName)}</b><small>Dari ${esc(from.label)} · tujuan: ${esc(source)}</small></div>
      <div class="route-stats"><span><b>${km(dist)}</b>jarak</span><span><b>${minutes(dur)}</b>perkiraan</span><span><b>${esc(data.fastest.accessLabel)}</b>akses</span></div></div>
      ${gap > 300 ? callout({ tone: 'yellow', icon: 'info', title: `Jalan terpetakan terdekat ±${km(gap)} dari warga`, text: 'Sisa jarak ditempuh di luar jalan terpetakan (garis abu-abu putus-putus, dihitung berjalan kaki). Konfirmasi jalur di lapangan.' }) : ''}
      ${data.fastest.hazards.length ? callout({ tone: 'red', icon: 'alert', title: 'Tujuan berada di zona bahaya', text: data.fastest.hazards.join(', ') }) : ''}
      <small>${road ? 'Rute jalan dari OSRM (kendaraan).' : 'Jaringan jalan tidak terjangkau; garis putus-putus adalah estimasi jarak lurus.'} ${esc(data.note)}</small>
      <div class="route-links"><a class="btn primary sm" target="_blank" rel="noopener" href="${esc(data.navigation.google)}">${icon('route')} Buka navigasi (Google Maps)</a> <a class="btn outline sm" target="_blank" rel="noopener" href="${esc(data.navigation.osm)}">OpenStreetMap</a></div>`;
  } catch (error) { if (info) info.innerHTML = `<small>Rute tidak dapat dihitung: ${esc(error.message)}</small>`; }
}

function shelterModal(id) {
  const s = D.shelters.find(item => item.id === id) || {};
  const v = D.villages[0] || {};
  const body = `<form id="modalForm" data-form="shelter" data-id="${esc(s.id || '')}" class="form-grid">
    <label class="field wide">Nama titik evakuasi<input name="name" required minlength="3" maxlength="160" value="${esc(s.name || '')}" placeholder="mis. Meunasah Gampong"></label>
    <label class="field wide">Alamat atau patokan<input name="address" maxlength="300" value="${esc(s.address || '')}"></label>
    <label class="field">Latitude<input name="latitude" type="number" step="any" required value="${esc(s.latitude ?? v.latitude ?? '')}"></label>
    <label class="field">Longitude<input name="longitude" type="number" step="any" required value="${esc(s.longitude ?? v.longitude ?? '')}"></label>
    <label class="field">Kapasitas (orang)<input name="capacity" type="number" min="0" max="100000" value="${esc(s.capacity ?? '')}"></label>
    <label class="field wide">Catatan (lantai atas, akses kursi roda, dsb.)<textarea name="accessibilityNotes" maxlength="500">${esc(s.accessibilityNotes || '')}</textarea></label></form>`;
  return modalShell({ title: s.id ? 'Ubah titik evakuasi' : 'Tambah titik evakuasi', sub: 'Koordinat dapat disalin dari peta (klik kanan di Google/OpenStreetMap).', body,
    foot: `<button class="btn outline" data-action="close-modal">Batal</button><button class="btn primary" type="submit" form="modalForm">Simpan</button>` });
}
function deviceNewModal() {
  const body = `<form id="modalForm" data-form="device-new" class="form-grid">
    <label class="field">ID kalung (opsional)<input name="id" maxlength="40" placeholder="otomatis: JAGA-XXXXXX"></label>
    <label class="field">Model<input name="model" maxlength="80" value="JAGA Rumah v1"></label>
    <label class="field">Nomor seri<input name="hardwareSerial" maxlength="80"></label>
    <label class="field">Simpan di<select name="villageId"><option value="">Gudang Pusat</option>${D.villages.map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('')}</select></label></form>`;
  return modalShell({ title: 'Daftarkan kalung', sub: 'Kunci kalung dibuat otomatis dan hanya ditampilkan sekali.', body,
    foot: `<button class="btn outline" data-action="close-modal">Batal</button><button class="btn primary" type="submit" form="modalForm">Daftarkan</button>` });
}
function villageHeadModal(id) {
  const v = D.villages.find(x => x.id === id);
  if (!v) return '';
  const body = `<form id="modalForm" data-form="village-head" data-id="${esc(id)}" style="display:grid;gap:14px">
    <p>Data kepala desa <b>${esc(v.name)}</b> dikelola JAGA Pusat dan dipakai saat mengirim pengumuman atau menghubungi desa.</p>
    <label class="field">Nama kepala desa<input name="headName" maxlength="160" value="${esc(v.headName || '')}" placeholder="mis. Muhammad Yusuf"></label>
    <label class="field">Telepon kepala desa<input name="headPhone" inputmode="tel" maxlength="30" value="${esc(v.headPhone || '')}" placeholder="mis. 0812xxxx"></label></form>`;
  return modalShell({ title: 'Kontak kepala desa', sub: 'Hanya JAGA Pusat yang dapat mengubah', body, foot: `<button class="btn outline" data-action="close-modal">Batal</button><button class="btn primary" type="submit" form="modalForm">Simpan</button>` });
}
function deviceKeyModal() {
  const k = state.ui.lastKey;
  const kind = k?.label || 'Kalung';
  const body = `<p>${esc(kind)} <b>${esc(k?.id || '')}</b> terdaftar. Salin kunci berikut ke firmware. <b>Kunci tidak akan ditampilkan lagi.</b></p>
    <div class="callout yellow"><span class="callout-icon">${icon('shield')}</span><div><b>Kunci ${esc(kind.toLowerCase())}</b><p style="word-break:break-all;font-family:monospace">${esc(k?.key || '')}</p></div></div>`;
  return modalShell({ title: `${kind} terdaftar`, body, foot: `<button class="btn primary" data-action="close-modal">Sudah saya simpan</button>` });
}
function deviceDistModal(id) {
  const d = D.devices.find(x => x.id === id) || {};
  const body = `<form id="modalForm" data-form="device-dist" data-id="${esc(id)}" style="display:grid;gap:14px">
    <p>Pindahkan kalung <b>${esc(id)}</b> (saat ini: <b>${esc(d.villageId ? villageName(d.villageId) : 'Gudang Pusat')}</b>).</p>
    <label class="field">Tujuan<select name="villageId"><option value="">Gudang Pusat (tarik kembali)</option>${D.villages.map(v => `<option value="${esc(v.id)}" ${d.villageId === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label></form>`;
  return modalShell({ title: 'Distribusikan kalung', sub: 'Desa kemudian memasangkannya pada warga.', body,
    foot: `<button class="btn outline" data-action="close-modal">Batal</button><button class="btn primary" type="submit" form="modalForm">Pindahkan</button>` });
}
function ticketResolveModal(id) {
  const t = D.tickets.find(x => x.id === id) || {};
  const body = `<form id="modalForm" data-form="ticket-resolve" data-id="${esc(id)}" style="display:grid;gap:14px">
    <p><b>${esc(t.title || '')}</b></p>
    <label class="field">Catatan penanganan<textarea name="resolutionNote" required minlength="5" maxlength="1000" placeholder="Apa yang sudah dilakukan Pusat">${esc(t.resolutionNote || '')}</textarea><small>Catatan ini terlihat oleh pelapor.</small></label></form>`;
  return modalShell({ title: 'Selesaikan kendala', body, foot: `<button class="btn outline" data-action="close-modal">Batal</button><button class="btn primary" type="submit" form="modalForm">Tandai selesai</button>` });
}
function rulesActivateModal(id) {
  const body = `<form id="modalForm" data-form="rules-activate" data-id="${esc(id)}" style="display:grid;gap:14px">
    ${callout({ tone: 'yellow', icon: 'alert', title: 'Bobot baru memengaruhi seluruh warna prioritas', text: 'Pastikan draf sudah disimpan dan disetujui. Aturan lama diarsipkan dan tidak dapat diaktifkan kembali.' })}
    <label class="field">Catatan persetujuan<textarea name="approvalNote" required minlength="5" maxlength="500" placeholder="mis. Disetujui rapat koordinasi BPBD dan Dinsos, 5 Okt 2026"></textarea></label></form>`;
  return modalShell({ title: 'Aktifkan aturan baru?', body, foot: `<button class="btn outline" data-action="close-modal">Batal</button><button class="btn primary" type="submit" form="modalForm">Aktifkan</button>` });
}
function accountEditModal(id) {
  const a = D.accounts.find(x => x.id === id);
  if (!a) return '';
  const body = `<form id="modalForm" data-form="account-edit" data-id="${esc(id)}" class="form-grid">
    <label class="field wide">Nama lengkap<input name="displayName" required maxlength="120" value="${esc(a.displayName)}"></label>
    <label class="field wide">Jabatan<input name="title" maxlength="120" value="${esc(a.title || '')}"></label>
    <label class="field wide">Kata sandi baru (opsional)<input name="password" type="password" minlength="8" autocomplete="new-password"><small>Kosongkan bila tidak diganti.</small></label>
    <label class="check wide"><input type="checkbox" name="active" ${a.active ? 'checked' : ''}><span>Akun aktif<small>Akun nonaktif tidak dapat masuk dan sesinya langsung berakhir.</small></span></label></form>`;
  return modalShell({ title: 'Ubah akun', sub: a.email, body, foot: `<button class="btn outline" data-action="close-modal">Batal</button><button class="btn primary" type="submit" form="modalForm">Simpan</button>` });
}
function dispatchModal(id) {
  const i = D.incidents.find(x => x.id === id);
  const teams = D.teams.filter(t => t.active !== false);
  const body = `<form id="modalForm" data-form="dispatch" data-id="${esc(id)}" style="display:grid;gap:14px">
    <p>Kerahkan tim Rescue ke <b>${esc(i?.ownerName || 'warga')}</b>. Tim menerima lokasi, prioritas, dan catatan Anda.</p>
    <label class="field">Tim<select name="teamId" required>${teams.map(t => `<option value="${esc(t.id)}">${esc(t.name)} · ${esc(TEAM_STATUS[t.status] || t.status)}</option>`).join('')}</select></label>
    <label class="field">Catatan untuk tim<textarea name="note" maxlength="200" placeholder="mis. Rumah paling ujung, jalan tergenang"></textarea></label></form>`;
  return modalShell({ title: 'Kerahkan tim Rescue', body: teams.length ? body : `<p>Belum ada tim Rescue yang melayani desa Anda.</p>`, foot: `<button class="btn outline" data-action="close-modal">Batal</button>${teams.length ? `<button class="btn primary" type="submit" form="modalForm">Kerahkan</button>` : ''}` });
}
function residentEditModal(m) {
  const d = m.detail, r = d.resident, has = code => (d.vulnerabilities || []).some(v => v.type?.code === code);
  const types = D.vulnTypes;
  const val = v => esc(v ?? '');
  const body = `<form id="modalForm" data-form="resident-edit" data-id="${esc(r.id)}" class="form-grid">
    <label class="field wide">Nama lengkap<input name="fullName" required minlength="3" maxlength="160" value="${val(r.full_name)}"></label>
    <label class="field">Tanggal lahir<input name="birthDate" type="date" value="${val(String(r.birth_date || '').slice(0, 10))}"></label>
    <label class="field">Jenis kelamin<select name="gender">${[['', 'Tidak diisi'], ['LAKI_LAKI', 'Laki-laki'], ['PEREMPUAN', 'Perempuan'], ['LAINNYA', 'Lainnya']].map(([v, l]) => `<option value="${v}" ${r.gender === v || (!r.gender && !v) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field">Telepon<input name="phone" inputmode="tel" value="${val(r.phone)}"></label>
    <label class="field wide">Alamat<input name="address" value="${val(r.address)}"></label>
    <label class="field">Latitude<input name="latitude" type="number" step="any" value="${val(r.latitude)}"></label>
    <label class="field">Longitude<input name="longitude" type="number" step="any" value="${val(r.longitude)}"></label>
    <fieldset class="wide"><legend>Kelompok rentan</legend><div class="checks">${types.map(t => `<label class="check"><input type="checkbox" name="vulnerability" value="${esc(t.code)}" ${has(t.code) ? 'checked' : ''}><span>${esc(t.name)}<small>${esc(t.category)}</small></span></label>`).join('')}</div></fieldset>
    <label class="field wide">Kemampuan evakuasi mandiri<select name="evacuationAbility">${[['', 'Belum dinilai'], ['MANDIRI', 'Dapat mengungsi sendiri'], ['PERLU_BANTUAN', 'Perlu bantuan mengungsi'], ['TIDAK_BISA_SENDIRI', 'Tidak bisa mengungsi sendiri']].map(([v, l]) => `<option value="${v}" ${(r.evacuation_ability || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="check wide"><input type="checkbox" name="timeCriticalMedical" ${r.time_critical_medical ? 'checked' : ''}><span>Kebutuhan medis yang tidak bisa ditunda</span></label>
    <label class="check wide"><input type="checkbox" name="livesAlone" ${r.lives_alone ? 'checked' : ''}><span>Tinggal sendiri</span></label>
    <label class="field">Catatan mobilitas<textarea name="mobilityNotes">${val(r.mobility_notes)}</textarea></label>
    <label class="field">Catatan komunikasi<textarea name="communicationNotes">${val(r.communication_notes)}</textarea></label>
    <label class="field">Kondisi medis relevan<textarea name="medicalNotes">${val(r.medical_notes)}</textarea></label>
    <label class="field">Kebutuhan saat evakuasi<textarea name="evacuationNotes">${val(r.evacuation_notes)}</textarea></label></form>`;
  return modalShell({ title: 'Ubah data warga', sub: r.full_name, body, wide: true, foot: `<button class="btn outline" data-action="close-modal">Batal</button><button class="btn primary" type="submit" form="modalForm">Simpan perubahan</button>` });
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
  if (state.modalMap) { try { state.modalMap.stop(); state.modalMap.remove(); } catch { /* sudah dilepas */ } state.modalMap = null; }
  if (!m) { root.innerHTML = ''; return; }
  const op = D.operations.find(o => o.id === m.id);
  const html = m.type === 'resident' ? residentModal() : m.type === 'account' ? accountModal() : m.type === 'shelter' ? shelterModal(m.id) : m.type === 'device-new' ? deviceNewModal() : m.type === 'account-edit' ? accountEditModal(m.id) : m.type === 'dispatch' ? dispatchModal(m.id) : m.type === 'resident-edit' ? residentEditModal(m) : m.type === 'device-key' ? deviceKeyModal() : m.type === 'device-dist' ? deviceDistModal(m.id) : m.type === 'ticket-resolve' ? ticketResolveModal(m.id) : m.type === 'rules-activate' ? rulesActivateModal(m.id) : m.type === 'sos' ? sosModal(m) : m.type === 'route' ? routeModal(m) : m.type === 'village-head' ? villageHeadModal(m.id) : m.type === 'alarm-confirm' ? alarmConfirmModal(m.payload) : m.type === 'emergency' ? emergencyModal()
    : m.type === 'water' && op ? waterModal(op) : m.type === 'close-op' && op ? closeOpModal(op) : m.type === 'confirm' ? confirmModal(m) : '';
  root.innerHTML = html;
  const form = $('#modalForm', root);
  if (form && m.type === 'account') syncAccountForm(form);
  if (m.type === 'route') loadRoute(m);
  if (m.type === 'sos') loadSosLog(m);
}
function openModal(modal) { state.ui.modal = modal; renderModal(); }
function closeModal() { state.ui.modal = null; pendingConfirm = null; renderModal(); flushPending(); }
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
  try {
    const result = await task();
    if (result && result.queued) toast('Tidak ada koneksi: perubahan disimpan di perangkat dan dikirim saat online');
    else if (success) toast(success);
    await loadData(true);
    return result;
  }
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
  'confirm-do'() { const job = pendingConfirm; closeModal(); if (job) job.action(); },
  'close-modal-bg'(el, event) { if (event.target === el) closeModal(); },
  severity(el) { state.ui.alarm.severity = el.dataset.value; render(); },
  'resident-filter'(el) { state.ui.residentFilter = el.dataset.value; render(); },
  'toggle-group'(el) {
    const tbody = el.closest('tbody.resident-group');
    if (!tbody) return;
    const closed = tbody.classList.toggle('closed');
    el.setAttribute('aria-expanded', String(!closed));
  },
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
  'open-route'(el) {
    const residentId = el.dataset.resident;
    const opId = Object.keys(D.rosters).find(id => (D.rosters[id] || []).some(r => r.residentId === residentId));
    if (!opId) return toast('Warga tidak ada pada operasi aktif', true);
    openModal({ type: 'route', opId, residentId, teamId: '' });
  },
  async 'incident-handled'(el) {
    const status = state.role === 'rescue' ? 'SAFE' : 'SAFE';
    run(() => JagaApi.updateIncidentStatus(el.dataset.id, status), 'Ditandai sudah ditangani').then(() => closeModal());
  },
  'announcement-delete'(el) { run(() => JagaApi.deleteAnnouncement(el.dataset.id), 'Pengumuman dihapus'); },
  'print-report'() { window.print(); },
  async 'edit-resident'(el) {
    try { openModal({ type: 'resident-edit', id: el.dataset.id, detail: await JagaApi.resident(el.dataset.id) }); }
    catch (error) { toast(`Gagal: ${error.message}`, true); }
  },
  'delete-resident'(el) {
    askConfirm({
      title: 'Nonaktifkan warga?', sub: 'Kalung dilepas, data disembunyikan',
      message: `Nonaktifkan <b>${esc(el.dataset.name)}</b>? Datanya disembunyikan dan kalungnya dilepas, riwayat tetap tersimpan.`,
      confirmLabel: 'Nonaktifkan', danger: true,
      run: () => run(() => JagaApi.deleteResident(el.dataset.id), 'Warga dinonaktifkan')
    });
  },
  'track-start'() { const select = $('#trackTeam'); if (select?.value) startTracking(select.value); },
  'track-stop'() { stopTracking(); },
  async 'op-tiles'(el) {
    const village = D.villages.find(v => v.id === el.dataset.village);
    if (!village || num(village.latitude) === null) return toast('Koordinat desa belum diketahui', true);
    await downloadTiles(Number(village.latitude), Number(village.longitude));
  },
  'device-loc'(el) { state.ui.pusat.deviceLoc = el.dataset.value; render(); },
  'ticket-filter'(el) { state.ui.pusat.ticketFilter = el.dataset.value; render(); },
  'ticket-status'(el) { run(() => JagaApi.updateTicket(el.dataset.id, { status: el.dataset.status }), 'Kendala mulai ditangani'); },
  'account-delete'(el) {
    askConfirm({
      title: 'Hapus akun?', sub: 'Tidak dapat dibatalkan',
      message: `Hapus akun <b>${esc(el.dataset.name)}</b>? Pengguna ini tidak dapat masuk lagi.`,
      confirmLabel: 'Hapus akun', danger: true,
      run: () => run(() => JagaApi.deleteAccount(el.dataset.id), 'Akun dihapus')
    });
  },
  async 'rules-revise'(el) { const r = await run(() => JagaApi.reviseRuleSet(el.dataset.id), 'Draf revisi dibuat'); if (r) { state.ui.pusat.ruleEditing = false; location.hash = '#/aturan'; } },
  'rules-edit'() { state.ui.pusat.ruleEditing = !state.ui.pusat.ruleEditing; render(); },
  'rules-discard'(el) {
    askConfirm({
      title: 'Buang draf revisi?',
      message: 'Buang draf revisi ini? Perubahan yang belum diaktifkan akan hilang.',
      confirmLabel: 'Buang draf', danger: true,
      run: () => run(() => JagaApi.publishRuleSet(el.dataset.id, { action: 'archive' }), 'Draf dibuang')
    });
  },
  async 'shelter-delete'(el) {
    const s = D.shelters.find(item => item.id === el.dataset.id);
    if (!s) return;
    askConfirm({
      title: 'Hapus titik evakuasi?',
      message: `Hapus titik evakuasi "<b>${esc(s.name)}</b>"? Tindakan ini tidak dapat dibatalkan.`,
      confirmLabel: 'Hapus', danger: true,
      run: () => run(() => JagaApi.deleteShelter(s.id), 'Titik evakuasi dihapus')
    });
  },
  async 'emergency-send'() {
    const button = $('#confirmSend'), villageId = ownVillageId();
    if (!villageId) return toast('Desa tujuan belum ditentukan', true);
    button.disabled = true; button.textContent = 'Mengirim…';
    try {
      const result = await JagaApi.emergency({ villageId, confirm: true });
      closeModal();
      toast(`Sinyal darurat dikirim ke ${result.devicesReached} kalung · operasi Rescue dibuka`);
      await loadData(true);
    } catch (error) { toast(`Gagal mengirim: ${error.message}`, true); button.disabled = false; button.textContent = 'Kirim sinyal darurat'; }
  },
  async 'alarm-send'() {
    const m = state.ui.modal; if (!m?.payload) return;
    const p = m.payload, button = $('#confirmSend');
    button.disabled = true; button.textContent = 'Mengirim…';
    try {
      const body = p.target === 'ALL'
        ? { villageId: p.villageId, targetType: 'DESA', severity: p.severity, message: p.message, waterLevelCm: p.waterLevelCm, observationNote: p.note }
        : p.target.startsWith('GROUP:')
          ? { villageId: p.villageId, targetType: 'KELOMPOK_RENTAN', targetReference: p.target.slice(6), severity: p.severity, message: p.message }
          : { villageId: p.villageId, targetType: 'PERANGKAT', targetReference: p.target, severity: p.severity, message: p.message };
      const result = await JagaApi.sendAlert(body);
      state.ui.alarm = { severity: 'SIAGA', target: 'ALL', message: '', waterLevelCm: '', note: '' };
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
    openModal({ type: 'alarm-confirm', payload: { villageId, severity: a.severity, target: a.target, message: a.message.trim() || DEFAULT_MESSAGE[a.severity], waterLevelCm: water, note: a.note.trim() || undefined } });
  },
  resident(form) {
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    delete payload.vulnerability;
    Object.assign(payload, {
      villageId: ownVillageId(), vulnerabilityCodes: data.getAll('vulnerability'), consented: data.has('consented'),
      livesAlone: data.has('livesAlone'), timeCriticalMedical: data.has('timeCriticalMedical')
    });
    for (const key of ['birthDate', 'gender', 'evacuationAbility', 'latitude', 'longitude']) if (payload[key] === '') delete payload[key];
    return run(() => JagaApi.createResident(payload), 'Data warga disimpan').then(ok => { if (ok) closeModal(); });
  },
  ticket(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    return run(() => JagaApi.createTicket({ ...data, villageId: state.role === 'desa' ? ownVillageId() : undefined }), 'Kendala dikirim ke JAGA Pusat').then(ok => { if (ok) form.reset(); });
  },
  'device-new'(form) {
    const payload = Object.fromEntries(new FormData(form).entries());
    for (const key of Object.keys(payload)) if (payload[key] === '') delete payload[key];
    return run(() => JagaApi.createDevice(payload)).then(result => { if (result) { state.ui.lastKey = { id: result.id, key: result.deviceKey }; openModal({ type: 'device-key' }); } });
  },
  'device-dist'(form) {
    return run(() => JagaApi.distributeDevice(form.dataset.id, new FormData(form).get('villageId')), 'Kalung dipindahkan').then(ok => { if (ok) closeModal(); });
  },
  'village-head'(form) {
    const d = new FormData(form);
    return run(() => JagaApi.updateVillage(form.dataset.id, { headName: String(d.get('headName') || '').trim() || null, headPhone: String(d.get('headPhone') || '').trim() || null }), 'Kontak kepala desa disimpan').then(ok => { if (ok) closeModal(); });
  },
  'ticket-resolve'(form) {
    return run(() => JagaApi.updateTicket(form.dataset.id, { status: 'RESOLVED', resolutionNote: new FormData(form).get('resolutionNote') }), 'Kendala diselesaikan').then(ok => { if (ok) closeModal(); });
  },
  async 'rules-save'(form) {
    const data = new FormData(form), id = form.dataset.id;
    const rules = (D.draftRules?.rules || []).slice().sort((a, b) => a.displayOrder - b.displayOrder).map((r, i) => ({
      factorKey: r.factorKey, operator: r.operator, comparisonValue: r.comparisonValue, displayOrder: r.displayOrder,
      scoreDelta: Number(data.get(`score_${i}`)), explanation: String(data.get(`text_${i}`) || '').trim(), active: data.has(`active_${i}`)
    }));
    if (rules.some(r => !Number.isFinite(r.scoreDelta) || !r.explanation)) return toast('Poin harus angka dan penjelasan tidak boleh kosong', true);
    const name = String(data.get('ruleName') || '').trim();
    if (name.length < 3) return toast('Nama draf minimal 3 huruf', true);
    const levels = ['SEGERA_TINJAU', 'RESPONS_CEPAT', 'DARURAT'];
    const mins = levels.map(lv => Number(data.get(`th_${lv}`)));
    if (mins.some(n => !Number.isFinite(n)) || !(mins[0] < mins[1] && mins[1] < mins[2])) return toast('Ambang harus berurutan: kuning < oranye < merah', true);
return run(async () => {
      await JagaApi.updateRuleSet(id, { name, description: String(data.get('ruleDescription') || '').trim() || null });
      await JagaApi.saveRules(id, rules);
      for (let i = 0; i < levels.length; i += 1) await JagaApi.saveThreshold(id, levels[i], mins[i]);
      state.ui.pusat.ruleEditing = false;
    }, 'Draf disimpan');
  },
  'rules-activate'(form) {
    return run(async () => {
      await JagaApi.publishRuleSet(form.dataset.id, { action: 'activate', approvalNote: new FormData(form).get('approvalNote') });
      state.ui.pusat.ruleEditing = false;
    }, 'Aturan baru diaktifkan').then(ok => { if (ok) closeModal(); });
  },
  thresholds(form) {
    const d = new FormData(form);
    return run(() => JagaApi.saveThresholds(ownVillageId(), { waspadaCm: Number(d.get('waspadaCm')), siagaCm: Number(d.get('siagaCm')), awasCm: Number(d.get('awasCm')) }), 'Ambang disimpan');
  },
  announcement(form) {
    const d = Object.fromEntries(new FormData(form).entries());
    const target = state.ui.pusat.announceTarget;
    let villageIds = null;
    if (target === 'VILLAGES') {
      villageIds = state.ui.pusat.announceVillages.slice();
      if (!villageIds.length) return toast('Pilih minimal satu desa tujuan', true);
    } else if (target === 'REGENCY') {
      const regency = (state.ui.pusat.announceRegency || '').trim();
      if (!regency) return toast('Pilih kabupaten tujuan', true);
      villageIds = D.villages.filter(v => v.regency === regency).map(v => v.id);
      if (!villageIds.length) return toast('Tidak ada desa di kabupaten tersebut', true);
    }
    return run(() => JagaApi.createAnnouncement({ ...d, expiresInHours: Number(d.expiresInHours), villageIds }), 'Pengumuman terkirim').then(ok => { if (ok) { state.ui.pusat.announceDraft = { title: '', body: '', expiresInHours: '72' }; form.reset(); } });
  },
  platform(form) {
    const d = new FormData(form);
    return run(() => JagaApi.savePlatform({
      device_offline_minutes: Number(d.get('device_offline_minutes')), alert_expiry_minutes: Number(d.get('alert_expiry_minutes')),
      rescue_view_medical: d.has('rescue_view_medical'), rescue_view_contacts: d.has('rescue_view_contacts'), rescue_view_gps: d.has('rescue_view_gps')
    }), 'Pengaturan disimpan');
  },
  report(form) {
    const d = Object.fromEntries(new FormData(form).entries());
    const { operationId, ...rest } = d;
    for (const key of Object.keys(rest)) if (rest[key] === '') delete rest[key];
    return run(() => JagaApi.createReport(operationId, rest), 'Laporan terkirim').then(ok => { if (ok) form.reset(); });
  },
  'account-edit'(form) {
    const d = new FormData(form);
    const payload = { displayName: d.get('displayName'), title: d.get('title') || null, active: d.has('active') };
    if (d.get('password')) payload.password = d.get('password');
    return run(() => JagaApi.updateAccount(form.dataset.id, payload), 'Akun diperbarui').then(ok => { if (ok) closeModal(); });
  },
  dispatch(form) {
    const d = new FormData(form);
    return run(() => JagaApi.assignTeam(form.dataset.id, { teamId: d.get('teamId'), note: d.get('note') || undefined, force: true }), 'Tim dikerahkan').then(ok => { if (ok) closeModal(); });
  },
  async 'resident-edit'(form) {
    const d = new FormData(form), id = form.dataset.id;
    const patch = {
      fullName: d.get('fullName'), phone: d.get('phone'), address: d.get('address'), evacuationAbility: d.get('evacuationAbility'),
      timeCriticalMedical: d.has('timeCriticalMedical'), livesAlone: d.has('livesAlone'),
      mobilityNotes: d.get('mobilityNotes'), communicationNotes: d.get('communicationNotes'), medicalNotes: d.get('medicalNotes'), evacuationNotes: d.get('evacuationNotes')
    };
    if (d.get('birthDate')) patch.birthDate = d.get('birthDate');
    if (d.get('gender')) patch.gender = d.get('gender');
    if (d.get('latitude') !== '' && d.get('longitude') !== '') { patch.latitude = Number(d.get('latitude')); patch.longitude = Number(d.get('longitude')); }
    const codes = d.getAll('vulnerability');
    const detail = state.ui.modal?.detail;
    return run(async () => {
      const result = await JagaApi.updateResident(id, patch);
      if (result && result.queued) return result;
      if (codes.length) {
        const known = new Map((detail?.vulnerabilities || []).map(v => [v.type?.code, v.severity]));
        await JagaApi.saveVulnerabilities(id, codes.map(code => ({ vulnerabilityTypeId: D.vulnTypes.find(t => t.code === code)?.id, severity: known.get(code) ?? 3 })).filter(v => v.vulnerabilityTypeId));
      }
      return result;
    }, 'Data warga diperbarui').then(ok => { if (ok) closeModal(); });
  },
  shelter(form) {
    const data = new FormData(form), id = form.dataset.id;
    const payload = Object.fromEntries(data.entries());
    for (const key of ['capacity', 'address', 'accessibilityNotes']) if (payload[key] === '') payload[key] = id ? null : undefined;
    if (!id) payload.villageId = ownVillageId();
    return run(() => (id ? JagaApi.updateShelter(id, payload) : JagaApi.createShelter(payload)), 'Titik evakuasi disimpan').then(ok => { if (ok) closeModal(); });
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
    return run(() => JagaApi.createAccount(payload), 'Akun dibuat').then(ok => { if (ok) closeModal(); });
  },
  water(form) {
    const data = new FormData(form), value = data.get('waterLevelCm');
    return run(() => JagaApi.updateOperation(form.dataset.id, { waterLevelCm: value === '' ? null : Number(value), note: data.get('note') || null }), 'Tinggi air diperbarui').then(ok => { if (ok) closeModal(); });
  },
  'close-op'(form) {
    return run(() => JagaApi.closeOperation(form.dataset.id, new FormData(form).get('note') || ''), 'Operasi ditutup; akses Rescue dicabut').then(ok => { if (ok) closeModal(); });
  }
};

function setPath(path, value) {
  const [group, key] = path.split('.');
  if (key) state.ui[group][key] = value; else state.ui[group] = value;
}

function setBusy(el, promise) {
  if (!el || el.dataset.busy) return;
  el.dataset.busy = '1';
  if (el.tagName === 'BUTTON') { el.disabled = true; el.classList.add('is-busy'); }
  promise.then(() => clearBusy(el), () => clearBusy(el));
}
function clearBusy(el) {
  delete el.dataset.busy;
  if (el.isConnected) { el.disabled = false; el.classList.remove('is-busy'); }
}
function formBusy(form, promise) {
  const buttons = form.id === 'modalForm'
    ? Array.from(document.querySelectorAll(`button[type="submit"][form="${form.id}"]`))
    : Array.from(form.querySelectorAll('button[type="submit"]'));
  buttons.forEach(b => { b.disabled = true; });
  promise.finally(() => buttons.forEach(b => { if (b.isConnected) b.disabled = false; }));
}

document.addEventListener('click', event => {
  const el = event.target.closest('[data-action]');
  if (el && el.dataset.action === 'close-modal-bg' && event.target !== el) return;
  if (el) { event.preventDefault(); const action = ACTIONS[el.dataset.action]; if (!action) return; const result = action(el, event); if (result && typeof result.then === 'function') setBusy(el, result); return; }
  if (state.ui.menu && !event.target.closest('[data-menu-panel]')) { state.ui.menu = null; renderNavbar(); }
});
document.addEventListener('submit', event => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const handler = FORMS[form.dataset.form]; if (!handler) return;
  const result = handler(form);
  if (result && typeof result.then === 'function') formBusy(form, result);
});
document.addEventListener('click', event => {
  const t = event.target.closest('[data-bind-target]');
  if (t) { state.ui.pusat.announceTarget = t.dataset.bindTarget; render(); }
});
document.addEventListener('input', event => {
  const el = event.target;
  if (el.dataset.keep) { if (state.ui.pusat.announceDraft) state.ui.pusat.announceDraft[el.dataset.keep] = el.value; return; }
  if (el.dataset.bind) {
    setPath(el.dataset.bind, el.value);
    if (el.dataset.keepFocus) { const pos = el.selectionStart; render(); const again = $(`[data-bind="${el.dataset.bind}"]`); if (again) { again.focus(); again.setSelectionRange(pos, pos); } }
  }
});
document.addEventListener('change', event => {
  const el = event.target;
  if (el.dataset.keep) { if (state.ui.pusat.announceDraft) state.ui.pusat.announceDraft[el.dataset.keep] = el.value; }
  if (el.dataset.toggleVillage) {
    const id = el.dataset.toggleVillage, list = state.ui.pusat.announceVillages.slice();
    if (el.checked && !list.includes(id)) list.push(id);
    else if (!el.checked) { const i = list.indexOf(id); if (i >= 0) list.splice(i, 1); }
    state.ui.pusat.announceVillages = list;
    render();
  }
  if (el.dataset.bind) {
    setPath(el.dataset.bind, el.value);
    if (el.dataset.bind === 'pusat.province') state.ui.pusat.village = '';
    if (el.dataset.bind === 'alarm.target' || el.dataset.bind.startsWith('pusat.')) render();
  }
  if (el.id === 'confirmCheck') { const send = $('#confirmSend'); if (send) send.disabled = !el.checked; }
  if (el.dataset.change === 'account-role') syncAccountForm(el.form);
  if (el.dataset.change === 'route-team' && state.ui.modal?.type === 'route') { state.ui.modal.teamId = el.value; renderModal(); }
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
    const [overview, safety, map, villages, incidents, alerts, notifications, operations, vulnTypes] = await Promise.all([
      JagaApi.overview(), safe(JagaApi.safety(), null), safe(JagaApi.map(), null), JagaApi.villages(),
      safe(JagaApi.incidents(), []), safe(JagaApi.alerts(), []), safe(JagaApi.notifications(), []), safe(JagaApi.operations('ACTIVE'), []), safe(JagaApi.vulnerabilityTypes(), [])
    ]);
    Object.assign(D, { overview, safety, map, villages, incidents, alerts, notifications, operations, vulnTypes });

    if (role === 'rescue') {
      const rosters = {};
      await Promise.all(operations.map(async op => { rosters[op.id] = await safe(JagaApi.roster(op.id), []); }));
      D.rosters = rosters;
      D.teams = await safe(JagaApi.teams(), []);
      D.residents = []; D.devices = [];
    } else {
      [D.residents, D.devices, D.shelters] = await Promise.all([safe(JagaApi.residents(), []), safe(JagaApi.devices(), []), safe(JagaApi.shelters(), [])]);
    }
    if (role === 'pusat') {
      const [accounts, ruleSets, audit, opsAll] = await Promise.all([safe(JagaApi.accounts(), []), safe(JagaApi.ruleSets(), []), safe(JagaApi.audit(), []), safe(JagaApi.operations('ALL'), [])]);
      Object.assign(D, { accounts, ruleSets, audit, opsAll });
      const active = ruleSets.find(s => s.status === 'ACTIVE');
      D.activeRules = active ? await safe(JagaApi.ruleSet(active.id), null) : null;
      D.thresholds = active ? await safe(JagaApi.thresholds(active.id), []) : [];
    }
    D.tickets = await safe(JagaApi.tickets(), []);
    D.announcements = await safe(JagaApi.announcements(), []);
    D.reports = await safe(JagaApi.reports(), []);
    if (role === 'desa') {
      [D.board, D.teams] = await Promise.all([safe(JagaApi.statusBoard(), null), safe(JagaApi.teams(), [])]);
    }
    if (role === 'rescue') {
      D.opsAll = await safe(JagaApi.operations('ALL'), []);
      const coverage = {};
      await Promise.all(D.operations.map(async op => { coverage[op.id] = await safe(JagaApi.coverage(op.id), null); }));
      D.coverage = coverage;
    }
    if (role === 'pusat') {
      [D.villageStat, D.platformInfo, D.governanceInfo] = await Promise.all([safe(JagaApi.villageStatus(), null), safe(JagaApi.platform(), null), safe(JagaApi.governance(), null)]);
    }
    if (role === 'pusat') {
      const draft = D.ruleSets.find(x => x.status === 'DRAFT');
      D.draftRules = draft ? await safe(JagaApi.ruleSet(draft.id), null) : null;
      D.draftThresholds = draft ? await safe(JagaApi.thresholds(draft.id), []) : [];
    }
    if (role === 'pusat' || role === 'desa') {
      try {
        const wRes = await fetch('https://api.open-meteo.com/v1/forecast?latitude=-6.2&longitude=106.8&current=temperature_2m,precipitation,weather_code&timezone=auto');
        if (wRes.ok) D.weather = await wRes.json();
      } catch (e) {}
    }
    state.error = '';
  } catch (error) {
    state.error = error.message;
    if (!silent) toast(`Gagal memuat: ${error.message}`, true);
  }
  state.loading = false;
  if (silent) safeRender(); else render();
}

/* Bunyi singkat saat SOS masuk; diam bila peramban belum mengizinkan audio. */
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach(t => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.value = 880; gain.gain.value = 0.15;
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + t); osc.stop(ctx.currentTime + t + 0.15);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch { /* audio tidak tersedia */ }
}

/* ------------------------------------------------ Pelacakan jalur dan peta offline (Rescue) */
function startTracking(teamId) {
  if (!navigator.geolocation) return toast('Perangkat ini tidak mendukung lokasi', true);
  const t = state.tracking = { teamId, count: 0, lastAt: null, error: '', sentAt: 0, watchId: null };
  t.watchId = navigator.geolocation.watchPosition(async pos => {
    const now = Date.now();
    if (now - t.sentAt < 15000) return;
    t.sentAt = now;
    try {
      await JagaApi.reportPosition(teamId, { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracyMeters: Math.round(pos.coords.accuracy) });
      t.count += 1; t.lastAt = new Date().toISOString(); t.error = '';
    } catch (error) { t.error = error.message; }
    if (currentRoute() === 'tim') safeRender();
  }, error => { t.error = error.code === 1 ? 'Izin lokasi ditolak' : 'Lokasi tidak tersedia'; render(); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  render();
}
function stopTracking() {
  if (state.tracking?.watchId != null) navigator.geolocation.clearWatch(state.tracking.watchId);
  state.tracking = null;
  render();
}

const TILE_CACHE = 'jaga-tiles-v1';
const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
/** Menyimpan ubin peta sekitar desa (radius sekitar 1,2 km, zoom 13 sampai 17) agar peta tetap tampil saat sinyal hilang (SRS FR-3.8). Jumlahnya kecil dengan sengaja. */
async function downloadTiles(lat, lng) {
  if (!('caches' in window)) return toast('Peramban ini tidak mendukung penyimpanan peta offline', true);
  const dLat = 1200 / 111320, dLng = dLat / Math.cos((lat * Math.PI) / 180);
  const urls = [];
  for (const z of [13, 14, 15, 16, 17]) {
    for (let x = lon2x(lng - dLng, z); x <= lon2x(lng + dLng, z); x += 1) {
      for (let y = lat2y(lat + dLat, z); y <= lat2y(lat - dLat, z); y += 1) urls.push(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`);
    }
  }
  const cache = await caches.open(TILE_CACHE);
  let done = 0, saved = 0;
  toast(`Mengunduh ${urls.length} ubin peta…`);
  for (const url of urls) {
    try {
      if (!(await cache.match(url))) { await cache.put(url, await fetch(url, { mode: 'no-cors' })); saved += 1; await new Promise(r => setTimeout(r, 120)); }
    } catch { /* lewati ubin yang gagal */ }
    done += 1;
    if (done % 25 === 0) toast(`Mengunduh peta offline… ${done}/${urls.length}`);
  }
  toast(`Peta offline siap: ${urls.length} ubin (${saved} baru). Peta area ini tetap tampil tanpa internet.`);
}

/** Rute cadangan tanpa server: garis lurus dari posisi tim terakhir ke warga, dihitung di perangkat. */
function offlineRoute(m) {
  const r = (D.rosters[m.opId] || []).find(x => x.residentId === m.residentId);
  const mine = state.session?.organizationId;
  const team = D.teams.find(t => t.id === m.teamId) || D.teams.find(t => t.latitude != null && t.organizationId === mine) || D.teams.find(t => t.latitude != null);
  if (!r || num(r.latitude) === null || !team || num(team.latitude) === null) return null;
  const from = { latitude: Number(team.latitude), longitude: Number(team.longitude), label: team.name };
  const to = { latitude: Number(r.latitude), longitude: Number(r.longitude), source: r.positionSource, positionAt: r.positionAt, accuracyMeters: r.positionAccuracyMeters };
  const R = 6371000, rad = x => (x * Math.PI) / 180;
  const a = Math.sin(rad(to.latitude - from.latitude) / 2) ** 2 + Math.cos(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.sin(rad(to.longitude - from.longitude) / 2) ** 2;
  const straight = 2 * R * Math.asin(Math.sqrt(a)), distance = Math.round(straight * 1.3);
  return {
    from, to, residentName: r.fullName,
    fastest: { distanceMeters: distance, durationSeconds: Math.round(distance / (15000 / 3600)), accessLabel: 'perkiraan offline', hazards: [], path: [from, to] },
    navigation: { google: `https://www.google.com/maps/dir/?api=1&origin=${from.latitude},${from.longitude}&destination=${to.latitude},${to.longitude}&travelmode=driving`, osm: `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${from.latitude}%2C${from.longitude}%3B${to.latitude}%2C${to.longitude}` },
    note: 'Offline: garis lurus dari data terakhir di perangkat. Konfirmasi jalur di lapangan.'
  };
}

/* ---------------------------------------------------------------- Boot */
async function boot() {
  try {
    const [session, config] = await Promise.all([JagaApi.me(), JagaApi.config().catch(() => ({}))]);
    state.session = session;
    state.role = String(session.role || 'DESA').toLowerCase();
    if (!ROLES[state.role]) state.role = 'desa';
    state.config = config;
  } catch { return; }
  document.title = `${ROLES[state.role].label} — JAGA`;
  if (!location.hash || !ROLES[state.role].pages.some(p => `#/${p[0]}` === location.hash)) location.hash = `#/${ROLES[state.role].home}`;
  await loadData();
  // Store-and-forward (SRS FR-2.9): antrean perubahan dikirim ulang otomatis saat koneksi kembali.
  const syncQueue = async () => {
    if (!JagaApi.pending() || JagaApi.net.offline) return;
    const result = await JagaApi.flush();
    if (result.sent) { toast(`${result.sent} perubahan offline berhasil disinkronkan`); await loadData(true); }
  };
  window.addEventListener('jaga-conn', () => { renderNavbar(); syncQueue(); });
  window.addEventListener('online', () => { JagaApi.setOffline(false); syncQueue(); });
  window.addEventListener('offline', () => JagaApi.setOffline(true));
  setInterval(syncQueue, 20000);
  syncQueue();
  JagaApi.stream((type, data) => {
    const who = data.owner_name || data.ownerName || 'warga';
    const messages = {
      'sos.created': `SOS diterima dari ${who}`, 'incident.updated': 'Status kejadian diperbarui', 'incident.closed': 'Kejadian ditutup',
      'alert.created': `Peringatan ${(SEVERITY[data.severity] || [data.severity])[0]} tercatat`, 'resident.created': 'Data warga baru ditambahkan',
      'ticket.created': 'Kendala teknis baru dilaporkan', 'ticket.updated': 'Kendala teknis diperbarui', 'announcement.created': `Pengumuman Pusat: ${data.title || ''}`, 'alert.receipt': data.status === 'ASSISTANCE_REQUESTED' ? 'Warga meminta bantuan lewat kalung' : '', 'operation.opened': 'Operasi dibuka: akses data warga berkalung di area terdampak', 'operation.updated': 'Operasi diperbarui', 'operation.closed': 'Operasi ditutup'
    };
    if (messages[type]) toast(messages[type]);
    if (type === 'sos.created') beep();
    loadData(true);
  });
  setInterval(() => loadData(true), 60000);
}

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
boot();
