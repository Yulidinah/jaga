const CACHE = 'jaga-shell-v27';
const TILE_CACHE = 'jaga-tiles-v1';
// Ubin peta disimpan setelah pernah dilihat atau diunduh lewat "Unduh peta offline", supaya peta tetap tampil tanpa internet.
const TILE_HOSTS = new Set(['tile.openstreetmap.org', 'server.arcgisonline.com']);
const SHELL = ['/', '/app', '/login', '/landing.css', '/auth.css', '/styles.css', '/app.js', '/api-client.js', '/manifest.webmanifest', '/assets/logo-mark.png', '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css'];

self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE && key !== TILE_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())
));

async function tile(request) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) cache.put(request.url, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method === 'GET' && TILE_HOSTS.has(url.hostname)) { event.respondWith(tile(event.request)); return; }
  // Permintaan lintas asal lain (font) dibiarkan ke peramban; fetch dari service worker terkena CSP connect-src dan gagal.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
