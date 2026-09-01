// SPDX-License-Identifier: Apache-2.0
//
// The full repertoire export in Band Settings (owner/admin only — see
// docs/PERMISSIONS.md and FullRepertoireExport.tsx) bundles ChordPro text,
// the full JSON snapshot, and every uploaded file into one ZIP. Uploads a
// real fixture PDF via the actual presign-upload/confirm flow
// (fileUploadTestClient.ts), same as anchor-sync.spec.ts.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { addSong, createVoice } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import {
  createThrowawayBand,
  DEMO_MEMBER_EMAIL,
  DEMO_OWNER_EMAIL,
  DEMO_PASSWORD,
  deleteThrowawayBand,
  login,
} from './fixtures';
import { uploadFileToBand } from './fileUploadTestClient';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';
import { addBandMember, getUserIdByEmail, withDb } from './testDb';

const ASSETS_DIR = fileURLToPath(new URL('../../server/src/seed/assets', import.meta.url));
const FIXTURE_PDF = `${ASSETS_DIR}/amazing-grace-full-score.pdf`;

const SERVER_URL = process.env.VITE_DEFAULT_SERVER_URL ?? 'http://localhost:3001';

/**
 * This test asserts on English button/heading text — but the seeded demo
 * accounts are shared, persistent Postgres rows (`user_prefs.locale`),
 * and bob's has ended up set to German from unrelated prior use of this
 * same environment. Pinning it back to English here makes the assertions
 * deterministic regardless of what a previous session left behind, rather
 * than this test silently depending on ambient account state it doesn't
 * own (see issue #81's same reasoning for demo-band content).
 */
async function resetLocaleToEnglish(email: string, password: string) {
  const token = await signInForToken(email, password);
  await fetch(`${SERVER_URL}/me/prefs`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ locale: 'en' }),
  });
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

test('the full repertoire export bundles ChordPro, JSON, and uploaded files into one ZIP — owner/admin only', async ({
  page,
}) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'full-repertoire-export');
  await withDb(async (client) => {
    const bobUserId = await getUserIdByEmail(client, DEMO_MEMBER_EMAIL);
    await addBandMember(client, bandId, bobUserId);
  });

  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();

  const songBody = '{title: Export Fixture Song}\n{start_of_verse}\n[C]Exported content[C]\n{end_of_verse}';
  const songId = addSong(setup.doc, {
    title: 'Export Fixture Song',
    artist: 'Acceptance Suite',
    key: 'C',
    bpm: 100,
    durationSec: 180,
    status: 'active',
    body: songBody,
  });
  const uploaded = await uploadFileToBand(ownerToken, bandId, FIXTURE_PDF, 'export-fixture.pdf', 'application/pdf');
  createVoice(setup.doc, songId, { name: 'Full Score', kind: 'files', files: [{ ...uploaded, pageCount: 2 }] });
  await flush();
  await resetLocaleToEnglish(DEMO_MEMBER_EMAIL, DEMO_PASSWORD);
  await resetLocaleToEnglish(DEMO_OWNER_EMAIL, DEMO_PASSWORD);

  try {
    // A plain member never sees the export section at all. Wait for the
    // page's own async data (the member list, populated by the same
    // effect that resolves the caller's own role) to actually finish
    // loading first — asserting absence right after navigation would
    // trivially "pass" before the section has had any chance to render
    // either way, regardless of whether the permission check is correct.
    await login(page, DEMO_MEMBER_EMAIL);
    await page.goto(`/bands/${bandId}/settings`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('cell', { name: 'Bob', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Export repertoire' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Log out' }).click();

    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/settings`);
    await expect(page.getByRole('heading', { name: 'Export repertoire' })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export everything as ZIP' }).click(),
    ]);
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error('Download produced no local path');

    const zip = await JSZip.loadAsync(await readFile(downloadPath));

    const jsonEntry = zip.file('bandstand-export.json');
    expect(jsonEntry).not.toBeNull();
    const snapshot = JSON.parse(await jsonEntry!.async('string')) as { songs: Record<string, { title: string }> };
    expect(Object.values(snapshot.songs).some((s) => s.title === 'Export Fixture Song')).toBe(true);

    const chordProEntry = zip.file('chordpro/export-fixture-song.cho');
    expect(chordProEntry).not.toBeNull();
    expect(await chordProEntry!.async('string')).toBe(songBody);

    const fileEntry = zip.file('files/export-fixture-song/full-score/export-fixture.pdf');
    expect(fileEntry).not.toBeNull();
    const exportedBytes = await fileEntry!.async('nodebuffer');
    const originalBytes = await readFile(FIXTURE_PDF);
    expect(exportedBytes.equals(originalBytes)).toBe(true);
  } finally {
    await deleteThrowawayBand(ownerToken, bandId);
    setup.provider.destroy();
  }
});
