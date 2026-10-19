import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // Runs once, before webServer and before any spec. Gated on E2E_MODE.
  globalSetup: './e2e/global-setup.ts',

  // Vitest owns src/**/*.test.ts; Playwright owns e2e/**/*.spec.ts. Two runners,
  // two extensions, no overlap — Lesson 12.2 Key Concept 4.
  testDir: './e2e',

  fullyParallel: false,

  // A committed `test.only` silently skips the rest of the suite. Locally it is a
  // convenience; in CI it is a green pipeline that ran one test.
  forbidOnly: !!process.env.CI,

  // ONE retry in CI, none locally. One distinguishes "flaky" from "broken";
  // three is a way of not knowing. Key Concept 7.
  retries: process.env.CI ? 1 : 0,

  // `workers` is spread conditionally rather than set to `undefined`: with
  // `exactOptionalPropertyTypes` (Lesson 07.3), assigning undefined to an
  // optional property is a type error, and "absent" means "use the default".
  ...(process.env.CI ? { workers: 1 } : {}),

  // `list` for the terminal `html for the clickable report. `open: 'never'`
  // because a report that launches a browser mid-CI-run is not helpful.
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    // 127.0.0.1, NOT localhost. Node may resolve `localhost` to ::1 while
    // `next dev` binds 0.0.0.0 (IPv4), and the symptom is ECONNREFUSED against
    // a server your browser can load. Key Concept 5.
    baseURL: 'http://127.0.0.1:3000',

    // No tracing on the happy path; a full trace of the run that failed. With
    // retries: 0 there is no first retry locally — use `--trace on` (Step 6).
    trace: 'on-first-retry',
  },

  // The name is a CONTRACT. Module 22 adds `a11y`, Module 23 adds `mutations`,
  // and Module 23's Starting State runs `--project=smoke`. Key Concept 6.
  projects: [{ name: 'smoke', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'npm run dev',
    // The Lesson 09.5 health endpoint: 200 only when Next AND WordPress answer.
    // The cost is in Key Concept 5 — a 503 means Playwright waits out the whole
    // 120 s. Lesson 12.4's global-setup is what turns that into one sentence.
    url: 'http://127.0.0.1:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
