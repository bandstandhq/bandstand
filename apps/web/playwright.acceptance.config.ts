// SPDX-License-Identifier: Apache-2.0
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-acceptance',
  // Self-heals stale `test-`-prefixed data a previous interrupted run left
  // behind (see globalSetup.ts) before every invocation — a no-op in CI,
  // where the acceptance workflow's own Postgres always starts fresh.
  globalSetup: './e2e-acceptance/globalSetup.ts',
  // Scenarios share one seeded band/server and mutate real state (invites,
  // membership, Awareness) — unlike playwright.config.ts's static-bundle
  // smoke test, running them in parallel would let them race each other.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // These scenarios exercise real multi-user sync over Hocuspocus, so both
  // the API/Hocuspocus server and a production build of the web app need
  // to be live for the whole suite — not just a static preview bundle.
  webServer: [
    {
      command: 'pnpm --filter @bandstand/server start',
      cwd: '../..',
      url: 'http://localhost:3001/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @bandstand/web exec vite preview --port 4173',
      cwd: '../..',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
