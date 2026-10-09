/**
 * Klien API JAGA. Semua respons backend dibungkus { data }; klien membuka bungkus itu.
 * Sesi memakai cookie HttpOnly (same-origin), tidak ada header peran dari sisi klien.
 */
/* Perubahan yang gagal terkirim karena jaringan disimpan di perangkat dan dikirim ulang saat online (SRS FR-2.9: store-and-forward).
   Alarm tidak ikut diantrekan: peringatan darurat tidak boleh tertunda diam-diam. */
const OUTBOX_KEY = 'jaga-outbox';
const QUEUEABLE = [
  ['POST', /^\/residents$/], ['PATCH', /^\/residents\/[^/]+$/], ['DELETE', /^\/residents\/[^/]+$/], ['PUT', /^\/residents\/[^/]+\/vulnerabilities$/],
  ['POST', /^\/tickets$/], ['POST', /^\/shelters$/], ['PATCH', /^\/shelters\/[^/]+$/], ['DELETE', /^\/shelters\/[^/]+$/],
  ['PATCH', /^\/incidents\/[^/]+\/status$/], ['PATCH', /^\/villages\/[^/]+\/thresholds$/], ['POST', /^\/operations\/[^/]+\/reports$/]
];
const readOutbox = () => { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch { return []; } };
const writeOutbox = items => { try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(items)); } catch { /* penyimpanan penuh atau diblokir */ } };

const JagaApi = {
  /** Status koneksi terakhir ke server; diperbarui pada setiap permintaan. */
  net: { offline: false },
  pending() { return readOutbox().length; },
  setOffline(value) {
    if (this.net.offline === value) return;
    this.net.offline = value;
    window.dispatchEvent(new CustomEvent('jaga-conn'));
  },

  async request(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    let response;
    try {
      response = await fetch(`/api${path}`, {
        credentials: 'same-origin',
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
      });
    } catch {
      this.setOffline(true);
      if (QUEUEABLE.some(([m, re]) => m === method && re.test(path))) {
        writeOutbox([...readOutbox(), { method, path, body: options.body ?? null, at: new Date().toISOString() }]);
        window.dispatchEvent(new CustomEvent('jaga-conn'));
        return { queued: true };
      }
      throw new Error('Tidak ada koneksi ke server. Perubahan ini tidak dapat disimpan sementara.');
    }
    this.setOffline(false);
    if (response.status === 401 && !path.startsWith('/auth/login')) {
      location.href = '/login';
      throw new Error('Sesi berakhir. Silakan masuk kembali.');
    }
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
    if (!response.ok) {
      const message = payload.error || 'Permintaan gagal';
      const detail = payload.detail || payload.message;
      throw new Error(detail ? `${message} — ${detail}` : message);
    }
    return payload.data;
  },

  /** Mengirim ulang antrean secara berurutan. Berhenti bila jaringan masih mati; membuang item yang ditolak server. */
  async flush() {
    if (this.flushing) return { sent: 0, dropped: 0 };
    this.flushing = true;
    let sent = 0, dropped = 0;
    try {
      let queue = readOutbox();
      while (queue.length) {
        const [item, ...rest] = queue;
        let response;
        try {
          response = await fetch(`/api${item.path}`, { method: item.method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: item.body });
        } catch { this.setOffline(true); break; }
        this.setOffline(false);
        if (response.status === 401) { location.href = '/login'; break; }
        if (response.ok) sent += 1; else dropped += 1;
        queue = rest;
        writeOutbox(queue);
      }
    } finally { this.flushing = false; window.dispatchEvent(new CustomEvent('jaga-conn')); }
    return { sent, dropped };
  },

  get(path) { return this.request(path); },
  send(method, path, body) { return this.request(path, { method, body: JSON.stringify(body ?? {}) }); },
  /** Endpoint berpaginasi mengembalikan { data: [...] }; endpoint lain langsung berupa daftar. */
  async list(path) {
    const result = await this.request(path);
    return Array.isArray(result) ? result : (result?.data ?? []);
  },

  /* --- Status warga, pengumuman, laporan, platform */
  statusBoard() { return this.get('/status-board'); },
  announcements() { return this.get('/announcements'); },
  createAnnouncement(data) { return this.send('POST', '/announcements', data); },
  deleteAnnouncement(id) { return this.send('DELETE', `/announcements/${encodeURIComponent(id)}`, {}); },
  reports() { return this.get('/operation-reports'); },
  createReport(opId, data) { return this.send('POST', `/operations/${encodeURIComponent(opId)}/reports`, data); },
  coverage(opId) { return this.get(`/operations/${encodeURIComponent(opId)}/coverage`); },
  villageStatus() { return this.get('/village-status'); },
  updateVillage(id, data) { return this.send('PATCH', `/villages/${encodeURIComponent(id)}`, data); },
  platform() { return this.get('/platform'); },
  savePlatform(settings) { return this.request('/platform', { method: 'PUT', body: JSON.stringify({ settings }) }); },
  governance() { return this.get('/governance'); },
  resident(id) { return this.get(`/residents/${encodeURIComponent(id)}`); },
  updateResident(id, data) { return this.send('PATCH', `/residents/${encodeURIComponent(id)}`, data); },
  deleteResident(id) { return this.send('DELETE', `/residents/${encodeURIComponent(id)}`, {}); },
  saveVulnerabilities(id, vulnerabilities) { return this.request(`/residents/${encodeURIComponent(id)}/vulnerabilities`, { method: 'PUT', body: JSON.stringify({ vulnerabilities }) }); },
  updateAccount(id, data) { return this.send('PATCH', `/accounts/${encodeURIComponent(id)}`, data); },
  assignTeam(incidentId, data) { return this.send('POST', `/incidents/${encodeURIComponent(incidentId)}/assignments`, data); },
  reportPosition(teamId, data) { return this.send('POST', `/teams/${encodeURIComponent(teamId)}/position`, data); },

  /* --- sesi */
  me() { return this.get('/auth/me'); },
  config() { return this.get('/config'); },
  async logout() { await this.send('POST', '/auth/logout').catch(() => {}); location.href = '/login'; },

  /* --- data umum */
  overview() { return this.get('/dashboard'); },
  safety() { return this.get('/dashboard/safety'); },
  map() { return this.get('/dashboard/map'); },
  villages() { return this.get('/villages'); },
  vulnerabilityTypes() { return this.get('/vulnerability-types'); },
  incidents() { return this.list('/incidents?limit=500'); },
  alerts() { return this.get('/alerts'); },
  notifications() { return this.get('/notifications'); },

  /* --- warga & perangkat */
  residents() { return this.list('/residents?limit=1000'); },
  devices() { return this.list('/devices?limit=500'); },
  shelters() { return this.get('/shelters'); },
  createShelter(data) { return this.send('POST', '/shelters', data); },
  updateShelter(id, data) { return this.send('PATCH', `/shelters/${id}`, data); },
  deleteShelter(id) { return this.send('DELETE', `/shelters/${id}`, {}); },
  createResident(data) { return this.send('POST', '/residents', data); },

  /* --- alarm & operasi */
  sendAlert(body) { return this.send('POST', '/alerts', body); },
  emergency(body) { return this.send('POST', '/alerts/emergency', body); },
  operations(status = 'ACTIVE') { return this.get(`/operations?status=${encodeURIComponent(status)}`); },
  incident(id) { return this.get(`/incidents/${encodeURIComponent(id)}`); },
  operationRoute(opId, residentId, teamId) { return this.get(`/operations/${encodeURIComponent(opId)}/route?residentId=${encodeURIComponent(residentId)}${teamId ? `&teamId=${encodeURIComponent(teamId)}` : ''}`); },
  roster(id) { return this.get(`/operations/${encodeURIComponent(id)}/roster`); },
  offlinePack(id) { return this.get(`/operations/${encodeURIComponent(id)}/offline-pack`); },
  updateOperation(id, patch) { return this.send('PATCH', `/operations/${encodeURIComponent(id)}`, patch); },
  closeOperation(id, note) { return this.send('POST', `/operations/${encodeURIComponent(id)}/close`, { note }); },

  /* --- insiden & tim */
  updateIncidentStatus(id, status) { return this.send('PATCH', `/incidents/${encodeURIComponent(id)}/status`, { status }); },
  teams() { return this.get('/teams'); },
  setTeamStatus(id, status) { return this.send('PATCH', `/teams/${encodeURIComponent(id)}/status`, { status }); },

  /* --- khusus Pusat */
  accounts() { return this.get('/accounts'); },
  createAccount(data) { return this.send('POST', '/accounts', data); },
  deleteAccount(id) { return this.send('DELETE', `/accounts/${encodeURIComponent(id)}`, {}); },
  tickets() { return this.get('/tickets'); },
  createTicket(data) { return this.send('POST', '/tickets', data); },
  updateTicket(id, data) { return this.send('PATCH', `/tickets/${encodeURIComponent(id)}`, data); },
  createDevice(data) { return this.send('POST', '/devices', data); },
  createDevicesBulk(data) { return this.send('POST', '/devices/bulk', data); },
  assignDevice(id, residentId) { return this.send('POST', `/devices/${encodeURIComponent(id)}/assign`, { residentId }); },
  unassignDevice(id) { return this.send('POST', `/devices/${encodeURIComponent(id)}/unassign`, {}); },
  distributeDevice(id, villageId) { return this.send('POST', `/devices/${encodeURIComponent(id)}/distribute`, { villageId: villageId || null }); },
  reviseRuleSet(id) { return this.send('POST', `/rulesets/${encodeURIComponent(id)}/revise`, {}); },
  updateRuleSet(id, data) { return this.send('PATCH', `/rulesets/${encodeURIComponent(id)}`, data); },
  saveRules(id, rules) { return this.request(`/rulesets/${encodeURIComponent(id)}/rules`, { method: 'PUT', body: JSON.stringify({ rules }) }); },
  publishRuleSet(id, body) { return this.send('POST', `/rulesets/${encodeURIComponent(id)}/publish`, body); },
  saveThreshold(ruleSetId, level, minScore) { return this.send('POST', '/thresholds', { ruleSetId, level, minScore }); },
  ruleSets() { return this.get('/rulesets'); },
  ruleSet(id) { return this.get(`/rulesets/${encodeURIComponent(id)}`); },
  thresholds(ruleSetId) { return this.get(`/thresholds?ruleSetId=${encodeURIComponent(ruleSetId)}`); },
  audit() { return this.get('/audit/recent'); },

  /** Umpan waktu nyata; autentikasi lewat cookie sesi. */
  stream(onEvent) {
    const types = ['sos.created', 'incident.updated', 'incident.closed', 'alert.created', 'resident.created',
      'operation.opened', 'operation.updated', 'operation.closed', 'device.updated', 'team.position', 'shelter.updated', 'ticket.created', 'ticket.updated', 'announcement.created', 'alert.receipt'];
    const source = new EventSource('/api/stream');
    for (const type of types) {
      source.addEventListener(type, event => { try { onEvent(type, JSON.parse(event.data)); } catch { /* abaikan data rusak */ } });
    }
    return source;
  }
};
window.JagaApi = JagaApi;
