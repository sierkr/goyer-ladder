// ============================================================
//  Playwright — browsertests (laag 4)
// ============================================================
//  De emulator wordt gestart door het commando eromheen
//  (firebase emulators:exec), niet door Playwright zelf. Playwright start
//  alleen de statische webserver die de app serveert.
// ============================================================
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.cjs',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,   // de tests delen één database
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://127.0.0.1:5000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: 'node tests/e2e/server.cjs',
    url: 'http://127.0.0.1:5000/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
