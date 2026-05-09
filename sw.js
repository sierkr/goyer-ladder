// Goyer Golf MP Ladder — Service Worker
const CACHE_VERSION = 'v147';
// v3.0.0-11.33: detecteer test-omgeving via SW-scope URL.
// Service worker draaiend onder /test/* → aparte cache, voorkomt conflict met productie.
const IS_TEST_ENV = self.registration && self.registration.scope.includes('/test/');
const CACHE_NAME = 'goyer-mp-' + CACHE_VERSION + (IS_TEST_ENV ? '-test' : '');

const STATIC_ASSETS = [
  './',
  './index.html',
  './js/app.js',
  './js/config.js',
  './js/store.js',
  './js/auth.js',
  './js/ladder-view.js',
  './js/nav.js',
  './js/ladder.js',
  './js/partij.js',
  './js/ronde.js',
  './js/uitslagen.js',
  './js/admin.js',
  './js/archief.js',
  './js/toernooi.js',
  './js/beheer.js',
  './js/knockout.js',
  './handleiding-partij-ronde.html',
  './toernooi-live.html',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './manifest.json',
  './version.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(STATIC_ASSETS).catch(err =>
        console.warn('SW: cache mislukt:', err)
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key.startsWith('goyer-mp-') && key !== CACHE_NAME)
            .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
      .then(() => {
        // v3.0.0-11.33: stuur SW_ACTIVATED naar alle open clients zodat ze
        // weten dat een nieuwe SW actief is en een versie-check kunnen doen.
        return self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
          .then(clients => {
            clients.forEach(client => {
              client.postMessage({ type: 'SW_ACTIVATED', cacheVersion: CACHE_VERSION });
            });
          });
      })
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Firestore/Auth API calls — altijd netwerk
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com') ||
      url.hostname.includes('securetoken.googleapis.com')) {
    return;
  }

  // version.json — altijd netwerk, nooit cache (update-detectie)
  if (url.pathname.endsWith('/version.json') || url.pathname === '/version.json') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() => {
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      })
    );
    return;
  }

  // Firebase SDK — cache first
  if (url.hostname.includes('gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
      )
    );
    return;
  }

  // Eigen bestanden — network first, cache als fallback
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
