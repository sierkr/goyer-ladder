// ============================================================
//  Playwright — browsertests (laag 4)
// ============================================================
//  De emulator wordt gestart door het commando eromheen
//  (firebase emulators:exec), niet door Playwright zelf. Playwright start
//  alleen de statische webserver die de app serveert.
//
//  LET OP — dit bestand doet bewust GEEN require('@playwright/test').
//  Playwright staat in tests/node_modules, maar dit bestand staat in de
//  hoofdmap. Node zoekt vanaf de map van het bestand zelf en kijkt dus niet
//  in tests/node_modules; dat gaf "Cannot find module '@playwright/test'".
//  defineConfig() en devices[] zijn puur gemak, geen noodzaak: een gewoon
//  object werkt precies hetzelfde.
// ============================================================

// v5.9.0: de poort is instelbaar met TEST_POORT. Standaard 5000, zodat er voor
// GitHub niets verandert. Op de Mint draait daar al een andere app op
// (gunicorn), en dan startte de testwebserver niet en viel de hele suite om
// met EADDRINUSE — een fout die niets met de app te maken heeft.
const POORT = process.env.TEST_POORT || '5000';
const BASIS = `http://127.0.0.1:${POORT}`;

// v5.11.0: CHROMIUM_PAD wijst een browser aan die al op de machine staat.
// Nodig op een werkplek waar Playwright zijn eigen browser niet mag ophalen
// (de hulpmachine waarop deze tests vóór oplevering draaien): daar staat
// Chromium al klaar, maar in een andere versiemap dan Playwright verwacht,
// en dan valt de hele suite om op "Executable doesn't exist".
// Zonder de variabele verandert er niets — op GitHub en op de Mint pakt
// Playwright gewoon zijn eigen gedownloade browser.
const CHROMIUM_PAD = process.env.CHROMIUM_PAD || '';

module.exports = {
  testDir: './tests/e2e',
  testMatch: '**/*.spec.cjs',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,   // de tests delen één database
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASIS,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
  },

  // Bewust 'chromium' en niet devices['Desktop Chrome']: dat profiel vraagt in
  // nieuwere Playwright-versies om de echte Google Chrome, en op de testmachine
  // installeren we alleen Chromium.
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 900 },
        ...(CHROMIUM_PAD ? { launchOptions: { executablePath: CHROMIUM_PAD } } : {}),
      },
    },
  ],

  webServer: {
    command: 'node tests/e2e/server.cjs',
    url: `${BASIS}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
};
