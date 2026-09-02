// SPDX-License-Identifier: Apache-2.0
//
// Personal markup (pen/highlighter/notes, AnnotationOverlay.tsx) used to
// always render inline in single-page mode, wherever PdfVoiceViewer
// happened to be mounted — including the small max-w-md preview in Song
// settings, which is too cramped for a real drawing toolbar, and with no
// way to collapse it out of the way while just reading. It's now off by
// default, toggled by one icon in Stage Mode's own toolbar, and Song
// settings points there instead of showing it inline.
import { fileURLToPath } from 'node:url';
import { addSong, createVoice, setAssignment } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { uploadFileToBand } from './fileUploadTestClient';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';
import { getUserIdByEmail, withDb } from './testDb';

const ASSETS_DIR = fileURLToPath(new URL('../../server/src/seed/assets', import.meta.url));
const FIXTURE_PDF = `${ASSETS_DIR}/amazing-grace-full-score.pdf`;

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

test('Song settings points to Stage Mode for markup; the brush icon there toggles the toolbar', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'annotate-toggle');

  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();
  const songId = addSong(setup.doc, {
    title: 'Annotate Toggle Fixture Song',
    artist: 'Acceptance Suite',
    key: 'C',
    bpm: 100,
    durationSec: 180,
    status: 'active',
    body: '',
  });
  const uploaded = await uploadFileToBand(ownerToken, bandId, FIXTURE_PDF, 'amazing-grace-full-score.pdf', 'application/pdf');
  const filesVoiceId = createVoice(setup.doc, songId, { name: 'Full Score', kind: 'files', files: [{ ...uploaded, pageCount: 2 }] });
  const ownerUserId = await withDb((client) => getUserIdByEmail(client, DEMO_OWNER_EMAIL));
  setAssignment(setup.doc, songId, ownerUserId, filesVoiceId);
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);

    // Song settings: a hint pointing at Stage Mode, no drawing toolbar here.
    await page.goto(`/bands/${bandId}/songs/${songId}/edit`);
    await page.getByText(/Voices \(2\)/).click();
    await page.getByRole('button', { name: 'Full Score · Files' }).click();
    const stageModeLink = page.getByRole('link', { name: 'Mark up this file in Stage Mode →' });
    await expect(stageModeLink).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pen' })).toHaveCount(0);

    // Following it lands in Stage Mode, where the toolbar is collapsed
    // behind one icon until it's clicked.
    await stageModeLink.click();
    await expect(page).toHaveURL(/\/play$/);
    await expect(page.getByRole('button', { name: 'Pen' })).toHaveCount(0);

    const annotateToggle = page.getByRole('button', { name: 'Mark up this page' });
    await expect(annotateToggle).toBeVisible();
    await annotateToggle.click();
    await expect(page.getByRole('button', { name: 'Pen' })).toBeVisible();

    await annotateToggle.click();
    await expect(page.getByRole('button', { name: 'Pen' })).toHaveCount(0);
  } finally {
    await deleteThrowawayBand(ownerToken, bandId);
    setup.provider.destroy();
  }
});
