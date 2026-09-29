const JagaApi = {
  role: 'DESA',
  setRole(role) { this.role = String(role || 'DESA').toUpperCase(); },
  async request(path, options = {}) {
    const response = await fetch(`/api${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'X-JAGA-Role': this.role, ...(options.headers || {}) }
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Permintaan gagal');
    return payload;
  },
  dashboard() { return this.request('/dashboard'); },
  residents() { return this.request('/residents'); },
  devices() { return this.request('/devices'); },
  incidents() { return this.request('/incidents'); },
  alerts() { return this.request('/alerts'); },
  vulnerabilityTypes() { return this.request('/vulnerability-types'); },
  createResident(data) { return this.request('/residents', { method: 'POST', body: JSON.stringify(data) }); },
  sendVillageAlert(severity = 'SIAGA', target = 'ALL', message = '') {
    return this.request('/alerts', { method: 'POST', body: JSON.stringify({ severity, target, message }) });
  },
  updateIncident(id, status) {
    return this.request(`/incidents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  },
  createEventStream(onEvent) {
    const stream = new EventSource('/api/stream');
    ['sos.created', 'incident.updated', 'alert.created', 'resident.created'].forEach(type => {
      stream.addEventListener(type, event => onEvent(type, JSON.parse(event.data)));
    });
    return stream;
  }
};
window.JagaApi = JagaApi;
