// SPDX-License-Identifier: Apache-2.0
//
// The Dashboard/Account Settings theme toggle used to be a separate,
// localStorage-only setting from Stage Mode's own theme toggle (issue
// #110) — switching one never affected the other, even for the same
// account. Both now read/write the same user_prefs.theme field.
import { addSong } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';

const SERVER_URL = process.env.VITE_DEFAULT_SERVER_URL ?? 'http://localhost:3001';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

// The seeded demo account's user_prefs.theme is shared, persistent Postgres
// state — a previous run's toggling (this spec included) can leave it on
// either value. Pinning it to a known state here makes the assertions
// below deterministic, same reasoning as full-repertoire-export.spec.ts's
// own resetLocaleToEnglish.
async function resetThemeToDark(token: string) {
  await fetch(`${SERVER_URL}/me/prefs`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ theme: 'dark' }),
  });
}

test('switching the theme in Account Settings is reflected in Stage Mode, and back', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'theme-sync');
  await resetThemeToDark(ownerToken);

  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();
  const songId = addSong(setup.doc, {
    title: 'Theme Sync Fixture Song',
    artist: 'Acceptance Suite',
    key: 'C',
    bpm: 100,
    durationSec: 180,
    status: 'active',
    body: '{title: Theme Sync Fixture Song}\n{start_of_verse}\n[C]Line one[C]\n{end_of_verse}',
  });
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);

    // Starts dark (reset above); switch to light from Account Settings.
    // Three explicit options now (System/Dark theme/Light theme, see
    // AccountSettings.tsx) rather than one toggle — each names the exact
    // choice, so aria-pressed marks whichever one is currently active.
    await page.goto('/settings');
    const darkThemeButton = page.getByRole('button', { name: 'Dark theme' });
    const lightThemeButton = page.getByRole('button', { name: 'Light theme' });
    await expect(darkThemeButton).toHaveAttribute('aria-pressed', 'true');
    await lightThemeButton.click();
    await expect(lightThemeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(darkThemeButton).toHaveAttribute('aria-pressed', 'false');
    await expect
      .poll(() => page.locator('html').evaluate((el) => el.classList.contains('light')))
      .toBe(true);

    // Stage Mode, entered fresh, already shows light — never toggled there.
    await page.goto(`/bands/${bandId}/songs/${songId}/play`);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('button', { name: 'Light' })).toBeVisible();

    // Switching back from inside Stage Mode is reflected in Account
    // Settings too.
    await page.getByRole('button', { name: 'Light' }).click();
    await expect(page.getByRole('button', { name: 'Dark' })).toBeVisible();

    await page.goto('/settings');
    await expect(darkThemeButton).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await resetThemeToDark(ownerToken);
    await deleteThrowawayBand(ownerToken, bandId);
    setup.provider.destroy();
  }
});
