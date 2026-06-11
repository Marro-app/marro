const CACHE = 'wcm-budget-v7';
// Never cache index.html — always fetch fresh so JS updates land immediately
const ASSETS = ['/manifest.json', '/icon.svg', '/fonts/inter-var.woff2', '/fonts/newsreader-var.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  // Navigation requests (HTML) — always network, no cache
  if(e.request.mode === 'navigate') { e.respondWith(fetch(e.request)); return; }
  // Everything else — network first, fall back to cache
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
