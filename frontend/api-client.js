/**
 * Klien API JAGA. Semua respons backend dibungkus { data }; klien membuka bungkus itu.
 * Sesi memakai cookie HttpOnly (same-origin), tidak ada header peran dari sisi klien.
 */
const JagaApi = {
  async request(path, options = {}) {
    const response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    if (response.status === 401 && !path.startsWith('/auth/login')) {
      location.href = '/login';
      throw new Error('Sesi berakhir. Silakan masuk kembali.');
    }
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
    if (!response.ok) throw new Error(payload.error || 'Permintaan gagal');
    return payload.data;
  },

  get(path) { return this.request(path); },
  send(method, path, body) { return this.request(path, { method, body: JSON.stringify(body ?? {}) }); },
  /** Endpoint berpaginasi mengembalikan { data: [...] }; endpoint lain langsung berupa daftar. */
  async list(path) {
    const result = await this.request(path);
    return Array.isArray(result) ? result : (result?.data ?? []);
  },

  /* --- sesi */
  me() { return this.get('/auth/me'); },
  config() { return this.get('/config'); },
  async logout() { await this.send('POST', '/auth/logout').catch(() => {}); location.href = '/login'; },

  /* --- data umum */
  overview() { return this.get('/dashboard'); },
  safety() { return this.get('/dashboard/safety'); },
  map() { return this.get('/dashboard/map'); },
  villages() { return this.get('/villages'); },
  hamlets() { return this.get('/hamlets'); },
  vulnerabilityTypes() { return this.get('/vulnerability-types'); },
  incidents() { return this.list('/incidents?limit=500'); },
  alerts() { return this.get('/alerts'); },
  notifications() { return this.get('/notifications'); },

  /* --- warga & perangkat */
  residents() { return this.list('/residents?limit=1000'); },
  devices() { return this.list('/devices?limit=500'); },
  createResident(data) { return this.send('POST', '/residents', data); },

  /* --- alarm & operasi */
  sendAlert(body) { return this.send('POST', '/alerts', body); },
  operations(status = 'ACTIVE') { return this.get(`/operations?status=${encodeURIComponent(status)}`); },
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
  ruleSets() { return this.get('/rulesets'); },
  ruleSet(id) { return this.get(`/rulesets/${encodeURIComponent(id)}`); },
  thresholds(ruleSetId) { return this.get(`/thresholds?ruleSetId=${encodeURIComponent(ruleSetId)}`); },
  audit() { return this.get('/audit/recent'); },

  /** Umpan waktu nyata; autentikasi lewat cookie sesi. */
  stream(onEvent) {
    const types = ['sos.created', 'incident.updated', 'incident.closed', 'alert.created', 'resident.created',
      'operation.opened', 'operation.updated', 'operation.closed', 'device.updated', 'team.position'];
    const source = new EventSource('/api/stream');
    for (const type of types) {
      source.addEventListener(type, event => { try { onEvent(type, JSON.parse(event.data)); } catch { /* abaikan data rusak */ } });
    }
    return source;
  }
};
window.JagaApi = JagaApi;
