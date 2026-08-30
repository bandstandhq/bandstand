// SPDX-License-Identifier: Apache-2.0
//
// Regression test for: every reason a PDF voice's page couldn't be shown —
// genuinely offline, or the file simply doesn't exist for this band (a 404
// from /presign-download) — collapsed into the same "Not available offline
// — reconnect" message. That's actively misleading for a 404: reconnecting
// can never fix a reference to an object this band never confirmed, but the
// message told the user to do exactly that.
import { fileURLToPath } from 'node:url';
import { addSong, createVoice, setAssignment } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { uploadFileToBand } from './fileUploadTestClient';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';
import { getUserIdByEmail, withDb } from './testDb';

const ASSETS_DIR = fileURLToPath(new URL('../../server/src/seed/assets', import.meta.url));
const FULL_SCORE_PDF = `${ASSETS_DIR}/amazing-grace-full-score.pdf`;

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

test('a file reference with no matching upload shows a not-found message, never the offline one', async ({ page }) => {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'pdf-not-found');
  const userId = await withDb((client) => getUserIdByEmail(client, DEMO_OWNER_EMAIL));
  const setup = connectTestBandDoc(bandId, token);
  await setup.waitForSynced();

  const songId = addSong(setup.doc, {
    title: 'Never Uploaded',
    artist: 'Acceptance Suite',
    key: 'C',
    bpm: 100,
    durationSec: 180,
    status: 'active',
    body: '',
  });
  // A well-formed but entirely made-up hash — no /presign-upload,
  // /confirm, or MinIO object was ever created for it, so the server's
  // attachments table (which /presign-download checks) has no row for
  // (bandId, sha256) and correctly answers 404 — not a network problem.
  const filesVoiceId = createVoice(setup.doc, songId, {
    name: 'PDF',
    kind: 'files',
    files: [{ sha256: '0'.repeat(64), filename: 'never-uploaded.pdf', mime: 'application/pdf', pageCount: 1 }],
  });
  // addSong already created a chordpro default voice first — without an
  // explicit assignment, getAssignedVoiceId would resolve to that one
  // (first by insertion order) instead of the files voice under test.
  setAssignment(setup.doc, songId, userId, filesVoiceId);
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/songs/${songId}/play`);

    await expect(page.getByText('no longer exists on the server', { exact: false })).toBeVisible();
    await expect(page.getByText('Not available offline', { exact: false })).not.toBeVisible();
  } finally {
    await deleteThrowawayBand(token, bandId);
    setup.provider.destroy();
  }
});

test('a real file blocked by a network failure shows the offline message, never the not-found one', async ({ page }) => {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'pdf-network-failure');
  const userId = await withDb((client) => getUserIdByEmail(client, DEMO_OWNER_EMAIL));
  const setup = connectTestBandDoc(bandId, token);
  await setup.waitForSynced();

  const uploaded = await uploadFileToBand(token, bandId, FULL_SCORE_PDF, 'amazing-grace-full-score.pdf', 'application/pdf');
  const file = { ...uploaded, pageCount: 2 };
  const songId = addSong(setup.doc, {
    title: 'Genuinely Uploaded',
    artist: 'Acceptance Suite',
    key: 'C',
    bpm: 100,
    durationSec: 180,
    status: 'active',
    body: '',
  });
  const filesVoiceId = createVoice(setup.doc, songId, { name: 'PDF', kind: 'files', files: [file] });
  setAssignment(setup.doc, songId, userId, filesVoiceId);
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    // A genuine, confirmed upload — the server would answer this
    // presign-download request just fine, so the failure here is purely
    // this one request never completing, the same class of failure as
    // being offline.
    await page.route(`**/bands/${bandId}/files/${file.sha256}/presign-download`, (route) => route.abort('connectionrefused'));
    await page.goto(`/bands/${bandId}/songs/${songId}/play`);

    await expect(page.getByText('Not available offline', { exact: false })).toBeVisible();
    await expect(page.getByText('no longer exists on the server', { exact: false })).not.toBeVisible();
  } finally {
    await deleteThrowawayBand(token, bandId);
    setup.provider.destroy();
  }
});
