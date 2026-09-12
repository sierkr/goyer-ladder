// ============================================================
//  Browsertests — gedeelde `test` en `expect`  (v5.11.0)
// ============================================================
//  Dit bestand geeft gewoon `test` en `expect` van Playwright door. Het doet
//  er EEN ding bij, en alleen als de omgevingsvariabele FIREBASE_SDK_MAP is
//  gezet: de Firebase-bibliotheek wordt dan uit een lokale map geserveerd in
//  plaats van opgehaald bij www.gstatic.com.
//
//  WAAROM. De app laadt Firebase rechtstreeks bij Google op. Op een machine
//  die daar niet bij kan, blijft de app hangen op "Verbinden met database…"
//  en valt ELKE browsertest om — op een fout die niets met de app te maken
//  heeft. Dat overkwam de hulpmachine waarop deze tests vóór oplevering
//  draaien. Met deze omweg draaien ze daar wel.
//
//  Zonder FIREBASE_SDK_MAP verandert er niets: op GitHub en op de Mint haalt
//  de browser de bibliotheek gewoon zelf op, precies zoals een speler dat doet.
//
//  De map moet de bestanden bevatten zoals Google ze serveert
//  (firebase-app.js, firebase-firestore.js, …). Ze staan in het npm-pakket
//  `firebase` van dezelfde versie, met dezelfde namen:
//      npm pack firebase@10.12.0 && tar xzf firebase-10.12.0.tgz
// ============================================================
const basis = require('@playwright/test');
const fs    = require('fs');
const path  = require('path');

const SDK_MAP = process.env.FIREBASE_SDK_MAP || '';

// Elk verzoek aan gstatic.com/firebasejs/... wordt beantwoord uit SDK_MAP.
// De bestanden verwijzen onderling óók naar gstatic; die verzoeken lopen door
// dezelfde afhandelaar en komen dus eveneens uit de map.
async function serveerSdkLokaal(context) {
  await context.route('https://www.gstatic.com/firebasejs/**', async (route) => {
    const naam     = path.basename(new URL(route.request().url()).pathname);
    const bestand  = path.join(SDK_MAP, naam);
    if (!naam.endsWith('.js') || !fs.existsSync(bestand)) {
      // Niet stilletjes doorlaten: dan hangt de app alsnog en zoek je je rot.
      throw new Error(`FIREBASE_SDK_MAP mist ${naam} (gezocht in ${SDK_MAP})`);
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: fs.readFileSync(bestand),
    });
  });
}

// De tests maken hun vensters op twee manieren aan: via de kant-en-klare
// `page`/`context` van Playwright, en via `browser.newContext()` voor de
// tests met twee of drie mensen tegelijk. Allebei moeten ze de omweg krijgen.
const test = SDK_MAP
  ? basis.test.extend({
      context: async ({ context }, use) => {
        await serveerSdkLokaal(context);
        await use(context);
      },
      browser: async ({ browser }, use) => {
        if (!browser._sdkOmweg) {
          const origineel = browser.newContext.bind(browser);
          browser.newContext = async (...args) => {
            const ctx = await origineel(...args);
            await serveerSdkLokaal(ctx);
            return ctx;
          };
          browser._sdkOmweg = true;
        }
        await use(browser);
      },
    })
  : basis.test;

module.exports = { test, expect: basis.expect };
