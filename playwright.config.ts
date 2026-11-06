import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite.
 *
 * The specs drive a production build against a database and storage directory of
 * their own (`e2e.db`, `.data/e2e-storage`), never the developer's `dev.db`, so a
 * failing run cannot corrupt a demo. The database is reset and seeded before
 * every run, which is what lets the delivery and agreement specs start from a
 * known mid-project state.
 *
 * `APP_URL`/`AUTH_URL` must match the port below: the mock PayPal approve URL and
 * the signed-URL callback are both built from it, and a mismatch would send the
 * browser to a port nothing is listening on.
 */

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * `PW_SERVER=external` tells the suite that the app is already running on
 * `PORT`, so Playwright must not try to start (or stop) one itself. Defaults to
 * managing the server, which is what `npm run e2e` expects.
 */
const useExternalServer = process.env.PW_SERVER === "external";

const E2E_ENV = {
  DATABASE_URL: "file:./e2e.db",
  LOCAL_STORAGE_DIR: ".data/e2e-storage",
  STORAGE_DRIVER: "local",
  PAYPAL_MODE: "mock",
  APP_URL: BASE_URL,
  AUTH_URL: BASE_URL,
  AUTH_TRUST_HOST: "true",
  AUTH_SECRET: "e2e-only-secret-0123456789abcdefghij",
} as const;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  // One worker: every spec shares one SQLite file and the demo seed.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: useExternalServer
    ? undefined
    : {
        // Seeding first means the server can boot against an already-populated
        // database, so the very first request never sees an empty schema.
        command: "npm run e2e:prepare && npm run build && npm run start -- -p 3100",
        url: BASE_URL,
        env: { ...E2E_ENV },
        // Locally an already-running server is reused so a failed spec can be re-run
        // without paying for a full rebuild. CI always starts from scratch.
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
