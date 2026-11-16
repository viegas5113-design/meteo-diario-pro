const CACHE_NAME = 'meteo-diario-pro-v1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './static/css/app.css',
  './static/js/meteo_utils.js',
  './static/js/db.js',
  './static/js/app.js',
  './static/icons/icon-192.png',
  './static/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Open-Meteo API: network-first, fallback to cached response
  if (req.url.includes('open-meteo.com')) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return resp;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // App shell: network-first, fallback to cache
  event.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp && resp.ok && req.url.startsWith(self.location.origin)) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return resp;
      })
      .catch(() => caches.match(req))
  );
});
