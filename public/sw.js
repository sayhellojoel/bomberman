// sw.js — Basic service worker for PWA installability
//
// __BUILD__ is substituted by the server with a hash of the client files, so
// every build gets its own cache and the activate handler below deletes the
// previous one. That's what stops an installed PWA booting yesterday's code.
// If this file is ever served unsubstituted the name is simply constant.
const CACHE_NAME = 'bomberman-__BUILD__';

// Offline fallback only. game.js and style.css are deliberately absent: they're
// requested with a ?v=<build> query, so a precached copy under the bare path
// could only ever be the wrong one. They're network-first below in any case.
const ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Network-first for WebSocket upgrade and dynamic content
  if (e.request.url.includes('ws') || e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(url.pathname);

  if (isImage) {
    // Cache-first for images — sprites and icons don't change between rounds
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return response;
        });
      })
    );
  } else {
    // Network-first for everything else
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
  }
});
