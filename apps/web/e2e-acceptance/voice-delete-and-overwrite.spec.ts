// SPDX-License-Identifier: Apache-2.0
//
// Deleting a whole voice (chordpro or files-kind) is admin/owner-only —
// see docs/PERMISSIONS.md's `voice:delete`/`file:overwrite` rows — and
// re-uploading a file that matches an existing one (by name or content
// hash) offers to overwrite it in place instead of silently creating a
// second, confusingly-similar voice.
import { fileURLToPath } from 'node:url';
import { addSong, createVoice } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_MEMBER_EMAIL, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { uploadFileToBand } from './fileUploadTestClient';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';
import { addBandMember, getUserIdByEmail, withDb } from './testDb';

const ASSETS_DIR = fileURLToPath(new URL('../../server/src/seed/assets', import.meta.url));
const FIXTURE_PDF = `${ASSETS_DIR}/amazing-grace-full-score.pdf`;

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

test('a member never sees the delete-voice option; an admin can delete a whole voice', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'voice-delete');
  await withDb(async (client) => {
    const bobUserId = await getUserIdByEmail(client, DEMO_MEMBER_EMAIL);
    await addBandMember(client, bandId, bobUserId);
  });

  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();
  const songId = addSong(setup.doc, {
    title: 'Voice Delete Fixture Song',
    artist: 'Acceptance Suite',
    key: 'C',
    bpm: 100,
    durationSec: 180,
    status: 'active',
    body: '',
  });
  await flush();

  try {
    // A plain member sees the voice, but never the delete option next to it.
    await login(page, DEMO_MEMBER_EMAIL);
    await page.goto(`/bands/${bandId}/songs/${songId}/edit`);
    await page.getByText(/Voices \(1\)/).click();
    await expect(page.getByText('Default · ChordPro')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete Default' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Log out' }).click();

    // The owner sees it, and using it removes the voice for good.
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/songs/${songId}/edit`);
    await page.getByText(/Voices \(1\)/).click();
    await page.getByRole('button', { name: 'Delete Default' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Delete "Default"?')).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete voice' }).click();

    await expect(page.getByText(/Voices \(0\)/)).toBeVisible();
    await expect(page.getByText('No parts yet.')).toBeVisible();
  } finally {
    await deleteThrowawayBand(ownerToken, bandId);
    setup.provider.destroy();
  }
});

test('re-uploading a file that matches an existing one by content offers overwrite or keep-both', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'voice-overwrite');

  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();
  const songId = addSong(setup.doc, {
    title: 'Voice Overwrite Fixture Song',
    artist: 'Acceptance Suite',
    key: 'C',
    bpm: 100,
    durationSec: 180,
    status: 'active',
    body: '',
  });
  const uploaded = await uploadFileToBand(ownerToken, bandId, FIXTURE_PDF, 'amazing-grace-full-score.pdf', 'application/pdf');
  createVoice(setup.doc, songId, { name: 'Trumpet in B', kind: 'files', files: [{ ...uploaded, pageCount: 2 }] });
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/songs/${songId}/edit`);
    await page.getByText(/Voices \(2\)/).click();

    // Re-select the exact same bytes — a duplicate by content hash, even
    // though nothing about the filename changed either.
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_PDF);

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('"amazing-grace-full-score.pdf" already exists')).toBeVisible();
    await expect(dialog.getByText(/Trumpet in B/)).toBeVisible();

    // Overwrite: no new voice, no name prompt, the existing one is reused.
    await dialog.getByRole('button', { name: 'Overwrite' }).click();
    await expect(page.getByText(/Voices \(2\)/)).toBeVisible();
    await expect(page.getByText('Trumpet in B · Files')).toBeVisible();

    // Re-selecting the same bytes again still detects the (now-replaced)
    // file as a duplicate, and this time "Keep both" creates a new voice
    // instead of touching the existing one.
    page.once('dialog', (d) => d.accept('Trumpet Backup'));
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_PDF);
    await expect(dialog.getByText('"amazing-grace-full-score.pdf" already exists')).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep both' }).click();

    await expect(page.getByText(/Voices \(3\)/)).toBeVisible();
    await expect(page.getByText('Trumpet Backup · Files')).toBeVisible();
  } finally {
    await deleteThrowawayBand(ownerToken, bandId);
    setup.provider.destroy();
  }
});
