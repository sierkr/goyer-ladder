// Goyer Golf MP Ladder — Service Worker
// ⚠ v5.46.0: APP_VERSIE staat met opzet op DEZELFDE regel als CACHE_VERSION.
// uitrollen.sh leest het versienummer van deze regel en controleert het; het
// nummer dat daar gecontroleerd wordt is dus precies het nummer dat de service
// worker gebruikt (zie kiesBron hieronder). Beide ophogen bij elke versie.
const CACHE_VERSION = 'v317'; const APP_VERSIE = 'v5.47.0';
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
  './js/scores.js',
  // v5.12.5: hcp.js stond hier niet, terwijl partij.js en ronde.js hem
  // nodig hebben. Hij belandde alleen in de cache als je toevallig een
  // partij had geopend voordat je offline ging.
  './js/hcp.js',
  './handleiding-partij-ronde.html',
  // v5.35.0: de tweede handleiding hoort er ook in — anders is hij offline niet
  // te openen, en die lijst groeit niet vanzelf mee.
  './handleiding-toernooi.html',
  './toernooi-live.html',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './logo.png',
  './manifest.json',
  './version.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // v5.46.0: { cache: 'reload' } — de kopie wordt sinds deze versie bij
      // het opstarten ook echt GEBRUIKT (zie kiesBron). Dan moet hij vers van
      // de server komen en niet uit de browsercache van tien minuten geleden;
      // anders zou een nieuwe versie oude bestanden in zijn kopie hebben.
      cache.addAll(STATIC_ASSETS.map(u => new Request(u, { cache: 'reload' }))).catch(err =>
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

// ============================================================
//  v5.46.0 — OPSTARTEN UIT DE KOPIE ALS DAT KAN
// ------------------------------------------------------------
//  WAT ER MIS WAS. Sierk: "het duurt vaak tot wel 30-60 sec voordat de
//  database bereikt is" — thuis én op de baan. Tot v5.45.1 haalde de app bij
//  ELKE start al zijn eigen bestanden (~1 MB) opnieuw van internet. De kopie op
//  de telefoon werd alleen gebruikt als het internet helemaal weg was. Bij
//  zwak bereik — wel een streepje, maar er komt niets door — wacht de telefoon
//  tot hij opgeeft, en dat kan een halve minuut of langer duren.
//
//  NU. Bij het openen van de app vraagt de service worker eerst alleen
//  version.json op (22 bytes), en wacht daar hooguit 3 seconden op:
//   - zelfde versie als deze service worker → alles uit de kopie (direct);
//   - geen antwoord binnen 3 seconden        → alles uit de kopie;
//   - een ANDERE versie                       → er is een update: alles van
//     internet, zoals vroeger, zodat je de nieuwe versie meteen krijgt.
//
//  ⚠ Waarom één beslissing voor alle bestanden en geen 3-secondengrens per
//  bestand: de bestanden importeren elkaar. Vlak na een uitrol staat er op
//  internet versie B en in de kopie versie A. Een grens per bestand geeft dan
//  een mengsel van A en B — en een nieuw bestand dat een functie zoekt die in
//  het oude niet bestaat, laat de app stil hangen. Deze keuze geldt daarom voor
//  de hele opstart tegelijk.
//
//  ⚠ De kopie is altijd één versie: hij wordt bij het installeren van deze
//  service worker in één keer gevuld (cache.addAll, alles of niets), met de
//  bestanden van precies deze versie.
// ============================================================
const VERSIE_WACHTTIJD_MS = 3000;

// Puur, zodat de rekentest hem kan natellen.
//   serverVersie: wat version.json zegt, of null als er geen antwoord kwam.
function kiesBron(eigenVersie, serverVersie) {
  if (!serverVersie) return 'kopie';
  return serverVersie === eigenVersie ? 'kopie' : 'netwerk';
}

// De laatste beslissing. Geldt voor alle bestanden die de pagina daarna ophaalt.
// null = nog niet beslist (bv. de service worker is net herstart): dan gedraagt
// hij zich zoals vóór v5.46.0.
let _bron = null;

async function vraagServerVersie() {
  const stop = new AbortController();
  const klok = setTimeout(() => stop.abort(), VERSIE_WACHTTIJD_MS);
  try {
    const url = new URL('version.json', self.registration.scope);
    const resp = await fetch(url, { cache: 'no-store', signal: stop.signal });
    if (!resp.ok) return null;
    const data = await resp.json();
    return (data && data.version) ? String(data.version).trim() : null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(klok);
  }
}

function haalVanNetwerk(request) {
  return fetch(request, { cache: 'no-store' })
    .then(response => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
      }
      return response;
    });
}

// Uit de eigen kopie; staat het er niet in, dan toch van internet.
// ignoreSearch alleen bij het openen van een pagina: './?ronde=…' en
// './?invite=…' zijn dezelfde index.html als './'.
function haalUitKopie(request, isPagina) {
  return caches.open(CACHE_NAME)
    .then(cache => cache.match(request, isPagina ? { ignoreSearch: true } : undefined))
    .then(cached => cached || haalVanNetwerk(request));
}

// Zoals vóór v5.46.0: internet eerst, kopie als het internet helemaal faalt.
function haalNetwerkEerst(request, isPagina) {
  return haalVanNetwerk(request)
    .catch(() => caches.match(request, isPagina ? { ignoreSearch: true } : undefined));
}

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

  // Eigen bestanden
  // v3.0.0-11.111: { cache: 'no-store' } zodat de browser-HTTP-cache wordt omzeild.
  // Zonder dit gaf een gewone reload vaak de oude (HTTP-gecachete) bytes terug en
  // werkte alleen een hard reset. Offline blijft werken via de cache-fallback.
  //
  // v5.46.0: zie OPSTARTEN UIT DE KOPIE hierboven. Bij het openen van een
  // pagina wordt beslist; alle bestanden daarna volgen die beslissing.
  if (url.origin === self.location.origin && event.request.method === 'GET') {
    const isPagina = event.request.mode === 'navigate';
    if (isPagina) {
      event.respondWith(
        vraagServerVersie().then(serverVersie => {
          _bron = kiesBron(APP_VERSIE, serverVersie);
          return _bron === 'kopie'
            ? haalUitKopie(event.request, true)
            : haalNetwerkEerst(event.request, true);
        })
      );
      return;
    }
    event.respondWith(
      _bron === 'kopie'
        ? haalUitKopie(event.request, false)
        : haalNetwerkEerst(event.request, false)
    );
  }
});
