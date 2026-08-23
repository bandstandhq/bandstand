// SPDX-License-Identifier: Apache-2.0
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // M0 scope: a static smoke test against the built bundle (vite preview),
  // not a full signup->login->dashboard round-trip against a live server —
  // that needs Postgres/Mailpit orchestration in CI and is a later milestone.
  webServer: {
    command: 'vite preview --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
