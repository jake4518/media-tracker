// Keeps the app loading fast and working offline with your last synced data.
// Only the app files are cached here. Your sheet data lives in the app's own storage.
const CACHE = 'media-tracker-v6';
const IMAGES = 'media-tracker-images'; // covers and posters, kept across app updates
const IMAGE_HOSTS = ['covers.openlibrary.org', 'image.tmdb.org', 'static.tvmaze.com'];
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== IMAGES).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return; // requests to Apps Script are POSTs and always go to the network
  const url = new URL(req.url);

  // App files: network first so updates show up right away, cache when offline or slow.
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Covers and posters: once downloaded, load from the phone.
  if (IMAGE_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(IMAGES).then(async cache => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // Google Fonts: serve from cache, refresh in the background.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(CACHE).then(async cache => {
        const hit = await cache.match(req);
        const fresh = fetch(req).then(res => { cache.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || fresh;
      })
    );
  }
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(req, { cache: 'no-cache' }), // always check GitHub for a newer copy instead of the browser's 10 minute cache
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3500)),
    ]);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req, { ignoreSearch: true });
    return hit || cache.match('./index.html');
  }
}
