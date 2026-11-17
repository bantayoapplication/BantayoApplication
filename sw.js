const CACHE_NAME = 'bantayo-v10';

// Your own pages and scripts: always try the network first so edits show up immediately,
// and fall back to the saved copy when offline.
const LOCAL_ASSETS = [
  './',
  './index.html',
  './login.html',
  './landing.html',
  './resident-view.html',
  './app.js',
  './baguio-map.js',
  './manifest.json'
];

// Third-party libraries: saved once, then served from the cache (works offline).
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/lucide@latest',
  'https://unpkg.com/exifreader@4/dist/exif-reader.js'
];
const CDN_HOSTS = ['cdn.tailwindcss.com', 'unpkg.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Add each file separately so one failed download can't break the whole install
      Promise.all(
        [...LOCAL_ASSETS, ...CDN_ASSETS].map((url) =>
          cache.add(url).catch((err) => console.warn('[SW] Could not pre-cache', url, err))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Your own files: network first, cache as the offline fallback
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => {
            if (cached) return cached;
            const accept = request.headers.get('accept') || '';
            if (accept.includes('text/html')) return caches.match('./index.html');
          })
        )
    );
    return;
  }

  // Known CDN libraries: cache first
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && (response.ok || response.type === 'opaque')) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else (Firebase, map tiles, images): leave to the browser, never intercept
});