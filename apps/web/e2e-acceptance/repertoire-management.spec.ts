// SPDX-License-Identifier: Apache-2.0
//
// Repertoire's search/filter, archive/restore, and permanent-delete
// confirmation — none had acceptance coverage before. Own throwaway band
// per issue #81.
import { addSong } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { connectTestBandDoc, signInForToken, type TestBandDoc } from './hocuspocusTestClient';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

function seedSong(setup: TestBandDoc, title: string, artist: string, key: string) {
  return addSong(setup.doc, {
    title,
    artist,
    key,
    bpm: 100,
    durationSec: 180,
    status: 'active',
    body: `{title: ${title}}\n[${key}]la`,
  });
}

test('searching filters by title, artist, and key; archiving and restoring move a song between tabs', async ({ page }) => {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'repertoire-search');
  const setup = connectTestBandDoc(bandId, token);
  await setup.waitForSynced();

  seedSong(setup, 'Amazing Grace', 'Traditional', 'G');
  seedSong(setup, 'Wonderwall', 'Oasis', 'F#m');
  seedSong(setup, 'Yesterday', 'The Beatles', 'F');
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/repertoire`);
    const search = page.getByPlaceholder('Search title, artist, or key');

    // By title.
    await search.fill('amazing');
    await expect(page.getByRole('cell', { name: 'Amazing Grace' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Wonderwall' })).toHaveCount(0);
    await expect(page.getByRole('cell', { name: 'Yesterday' })).toHaveCount(0);

    // By artist.
    await search.fill('oasis');
    await expect(page.getByRole('cell', { name: 'Wonderwall' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Amazing Grace' })).toHaveCount(0);

    // By key — "f#m" is specific enough not to also match Yesterday's "F".
    await search.fill('f#m');
    await expect(page.getByRole('cell', { name: 'Wonderwall' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Yesterday' })).toHaveCount(0);

    await search.fill('');
    await expect(page.getByRole('cell', { name: 'Amazing Grace' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Wonderwall' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Yesterday' })).toBeVisible();

    // Archive Yesterday: disappears from the active list...
    await page.locator('tr', { hasText: 'Yesterday' }).getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('cell', { name: 'Yesterday' })).toHaveCount(0);
    await expect(page.getByRole('cell', { name: 'Amazing Grace' })).toBeVisible();

    // ...and appears in the Archive tab instead.
    await page.getByRole('button', { name: /Archive \(\d+\)/ }).click();
    await expect(page.getByRole('cell', { name: 'Yesterday' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Amazing Grace' })).toHaveCount(0);

    // Restoring puts it back in the active list.
    await page.locator('tr', { hasText: 'Yesterday' }).getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByRole('cell', { name: 'Yesterday' })).toHaveCount(0); // gone from Archive view
    await page.getByRole('button', { name: 'Active' }).click();
    await expect(page.getByRole('cell', { name: 'Yesterday' })).toBeVisible();
  } finally {
    await deleteThrowawayBand(token, bandId);
    setup.provider.destroy();
  }
});

test('permanently deleting a song requires typing its exact title first', async ({ page }) => {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'repertoire-delete');
  const setup = connectTestBandDoc(bandId, token);
  await setup.waitForSynced();

  const title = 'Delete Forever Fixture';
  seedSong(setup, title, 'Acceptance Suite', 'C');
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/repertoire`);
    await page.locator('tr', { hasText: title }).getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('button', { name: /Archive \(\d+\)/ }).click();

    await page.locator('tr', { hasText: title }).getByRole('button', { name: 'Delete forever' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText("This can't be undone.", { exact: false })).toBeVisible({ timeout: 5000 });

    const confirmInput = dialog.getByRole('textbox');
    const confirmButton = dialog.getByRole('button', { name: 'Delete forever' });

    // Wrong text — button stays disabled.
    await confirmInput.fill('not the title');
    await expect(confirmButton).toBeDisabled();

    // Partial match — still disabled.
    await confirmInput.fill(title.slice(0, -1));
    await expect(confirmButton).toBeDisabled();

    // Exact title — enabled, and actually deletes.
    await confirmInput.fill(title);
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('cell', { name: title })).toHaveCount(0);
  } finally {
    await deleteThrowawayBand(token, bandId);
    setup.provider.destroy();
  }
});
