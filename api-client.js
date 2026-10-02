const JagaApi = {
  session: null,

  /** Semua respons API dibungkus { data }. Klien membuka bungkus itu dan menyatukan bentuk daftar. */
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
  /** Endpoint daftar berpaginasi mengembalikan { data: [...] }; endpoint lain langsung array. */
  async list(path) {
    const result = await this.request(path);
    return Array.isArray(result) ? result : (result?.data ?? []);
  },

  async login(email, password) {
    const result = await this.request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    this.session = result.session;
    return result.session;
  },
  async logout() { await this.request('/auth/logout', { method: 'POST', body: '{}' }).catch(() => {}); location.href = '/login'; },
  async me() { this.session = await this.request('/auth/me'); return this.session; },

  dashboard() { return this.request('/dashboard'); },
  residents() { return this.list('/residents?limit=1000'); },
  devices() { return this.list('/devices?limit=500'); },
  incidents() { return this.list('/incidents?limit=500'); },
  alerts() { return this.request('/alerts'); },
  villages() { return this.request('/villages'); },
  vulnerabilityTypes() { return this.request('/vulnerability-types'); },
  createResident(data) { return this.request('/residents', { method: 'POST', body: JSON.stringify(data) }); },
  /** target: 'ALL' (seluruh desa) atau ID perangkat tertentu. */
  sendVillageAlert(villageId, severity = 'SIAGA', target = 'ALL', message = '') {
    const body = target === 'ALL'
      ? { villageId, targetType: 'DESA', severity, message }
      : { villageId, targetType: 'PERANGKAT', targetReference: target, severity, message };
    return this.request('/alerts', { method: 'POST', body: JSON.stringify(body) });
  },
  updateIncident(id, status) {
    return this.request(`/incidents/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  },
  createEventStream(onEvent) {
    // EventSource memakai cookie sesi (same-origin); tidak ada header khusus.
    const stream = new EventSource('/api/stream');
    ['sos.created', 'incident.updated', 'incident.closed', 'alert.created', 'resident.created'].forEach(type => {
      stream.addEventListener(type, event => { try { onEvent(type, JSON.parse(event.data)); } catch { /* abaikan data rusak */ } });
    });
    return stream;
  }
};
window.JagaApi = JagaApi;
