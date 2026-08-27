// SPDX-License-Identifier: Apache-2.0
//
// A repertoire row plays the song (Stage Mode, no setlist) rather than
// opening the editor — editing has its own explicit affordance (a pencil
// icon in the row, and an "Edit song" button from the play view itself).
// Own throwaway band per issue #81.
import { addSong } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

test('a repertoire row opens the song to play, with its own separate edit affordances', async ({ page }) => {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'repertoire-play');
  const setup = connectTestBandDoc(bandId, token);
  await setup.waitForSynced();

  const songTitle = 'Repertoire Play Fixture';
  addSong(setup.doc, {
    title: songTitle,
    artist: 'Acceptance Suite',
    key: 'C',
    bpm: 100,
    durationSec: 180,
    status: 'active',
    body: `{title: ${songTitle}}\n{start_of_verse}\n[C]la la la[C]\n{end_of_verse}`,
  });
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/repertoire`);

    const row = page.locator('tr', { hasText: songTitle });
    // The title cell specifically — not the whole row's width, which also
    // contains the actions column's own real buttons (Archive etc.) that
    // are *correctly* meant to intercept a click there instead of the
    // stretched link. Within the title cell, though, only plain text sits
    // in front of the stretched link, so a click anywhere across it —
    // left edge, middle, right edge, not just Playwright's own default
    // center — must land on the link. This is exactly the kind of
    // stretched-link stacking bug a plain "is it visible" check would miss
    // (see the fix in EventDetail.tsx/PollDetail.tsx from the calendar
    // round, where a `relative` sibling shadowed the link at its own text).
    const titleCell = row.getByRole('cell').first();
    const pencilLink = row.getByRole('link', { name: `Edit ${songTitle}` });

    async function clickTitleCellAt(x: number) {
      const cellBox = await titleCell.boundingBox();
      if (!cellBox) throw new Error('Could not measure the title cell');
      await page.mouse.click(x, cellBox.y + cellBox.height / 2);
      await expect(page).toHaveURL(/\/songs\/.+\/play$/);
      await page.goBack();
      await expect(page).toHaveURL(/\/repertoire$/);
    }

    const leftEdgeBox = await titleCell.boundingBox();
    if (!leftEdgeBox) throw new Error('Could not measure the title cell');
    await clickTitleCellAt(leftEdgeBox.x + 10); // near the cell's left edge

    const middleBox = await titleCell.boundingBox();
    if (!middleBox) throw new Error('Could not measure the title cell');
    await clickTitleCellAt(middleBox.x + middleBox.width / 2); // roughly on the title text

    const pencilBox = await pencilLink.boundingBox();
    if (!pencilBox) throw new Error('Could not measure the pencil icon');
    await clickTitleCellAt(pencilBox.x - 8); // just before the pencil icon, not on it

    await row.getByRole('link', { name: `Play ${songTitle}` }).click();
    await page.waitForURL(/\/songs\/.+\/play$/);

    // Setlist-specific chrome is gone.
    await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Previous' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit setlist' })).toHaveCount(0);
    // What stays.
    await expect(page.getByRole('heading', { name: songTitle })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Transpose up' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Auto-scroll' })).toBeVisible();

    // A separate, explicit way to edit, from the play view itself.
    await page.getByRole('button', { name: 'Edit song' }).click();
    await page.waitForURL(/\/edit$/);

    // Exiting play mode goes back to the repertoire list, not a setlist.
    await page.goBack();
    await page.waitForURL(/\/songs\/.+\/play$/);
    await page.getByRole('button', { name: 'Exit' }).click();
    await page.waitForURL(/\/repertoire$/);

    // The row's own pencil icon is a second, independent way to edit.
    await row.getByRole('link', { name: `Edit ${songTitle}` }).click();
    await page.waitForURL(/\/edit$/);
  } finally {
    await deleteThrowawayBand(token, bandId);
    setup.provider.destroy();
  }
});
