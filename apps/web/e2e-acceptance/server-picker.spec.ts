// SPDX-License-Identifier: Apache-2.0
//
// The login/signup server picker (see docs/ARCHITECTURE.md's "server URL is
// configurable, not hardcoded", ADR-0001). Points the override at the same
// real server this suite already runs against — not a second server — so
// this proves the override mechanism actually takes effect end to end
// (persisted, applied after reload, visible read-only in account settings,
// still fully functional) without needing a second Bandstand instance.
import { expect, test } from '@playwright/test';
import { DEMO_OWNER_EMAIL, DEMO_PASSWORD, login } from './fixtures';

const SERVER_URL = process.env.VITE_DEFAULT_SERVER_URL ?? 'http://localhost:3001';
const HOCUSPOCUS_URL = process.env.VITE_DEFAULT_HOCUSPOCUS_URL ?? 'ws://localhost:3002';

test('choosing a custom server persists it, applies it, and is read-only in account settings while signed in', async ({
  page,
}) => {
  await page.goto('/login');
  await expect(page.getByText('Server: Default server')).toBeVisible();

  await page.getByRole('button', { name: 'Change' }).click();
  await page.getByRole('radio', { name: 'Custom server' }).click();
  await page.getByLabel('Server URL').fill(SERVER_URL);
  await page.getByLabel('Sync URL').fill(HOCUSPOCUS_URL);
  await page.getByRole('button', { name: 'Save' }).click();

  // Saving reboots the app (a full navigation) — the override is now active.
  await page.waitForURL(/\/login/);
  await expect(page.getByText(`Server: ${SERVER_URL}`)).toBeVisible();

  // Still fully usable — it points at the same real server, just via the
  // override path instead of the build-time default.
  await login(page, DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  await page.goto('/settings');
  await expect(page.getByText(`Using ${SERVER_URL}`)).toBeVisible();
  await expect(page.getByText('only changeable while signed out')).toBeVisible();

  // Switching back to the default is only offered once signed out again.
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.waitForURL(/\/login/);
  await page.getByRole('button', { name: 'Change' }).click();
  await page.getByRole('radio', { name: 'Default server' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(/\/login/);
  await expect(page.getByText('Server: Default server')).toBeVisible();
});

test('an invalid custom server address is rejected before anything is saved', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Change' }).click();
  await page.getByRole('radio', { name: 'Custom server' }).click();
  await page.getByLabel('Server URL').fill('not-a-url');
  await page.getByLabel('Sync URL').fill('also-not-a-url');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText(/Enter a valid server URL/)).toBeVisible();
  // Still on /login, nothing was applied.
  await expect(page).toHaveURL(/\/login$/);

  const stored = await page.evaluate(() => localStorage.getItem('bandstand.serverConfig'));
  expect(stored).toBeNull();
});

test('switching servers clears the locally cached active-band selection', async ({ page }) => {
  await login(page, DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  // DashboardRedirect sets it asynchronously right after landing — poll
  // instead of a synchronous read, which can race that commit.
  await page.waitForFunction(() => localStorage.getItem('bandstand-active-band') !== null);

  await page.getByRole('button', { name: 'Log out' }).click();
  await page.waitForURL(/\/login/);
  await page.getByRole('button', { name: 'Change' }).click();
  await page.getByRole('radio', { name: 'Custom server' }).click();
  await page.getByLabel('Server URL').fill(SERVER_URL);
  await page.getByLabel('Sync URL').fill(HOCUSPOCUS_URL);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(/\/login/);

  const after = await page.evaluate(() => localStorage.getItem('bandstand-active-band'));
  expect(after).toBeNull();
});
