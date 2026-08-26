// SPDX-License-Identifier: Apache-2.0
//
// A fresh, single-test-owned band (see fixtures.ts's createThrowawayBand) —
// this test mutates its setlist freely via real drag gestures and deletes
// the whole band afterward, rather than touching the shared demo-band seed
// data other tests and a developer's own manual testing rely on staying
// recognizable (issue #81).
import { addSetlistItem, addSong, buildSongItem, createSetlist } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

/** A point near the left edge of a row's box — inside the label/drag-handle area on either side of this fix, never on a right-aligned action button. */
async function leftEdgePoint(locator: import('@playwright/test').Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Could not measure element for drag point');
  return { x: box.x + 20, y: box.y + box.height / 2 };
}

/** Drags from one point to another via real incremental pointer moves — dnd-kit's sensors need actual pointermove deltas to recognize an active drag, not a single teleporting move. Leaves the mouse button held; call `page.mouse.up()` to complete the drop. */
async function dragTo(page: import('@playwright/test').Page, fromPoint: { x: number; y: number }, toPoint: { x: number; y: number }) {
  await page.mouse.move(fromPoint.x, fromPoint.y);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      fromPoint.x + ((toPoint.x - fromPoint.x) * i) / steps,
      fromPoint.y + ((toPoint.y - fromPoint.y) * i) / steps,
      { steps: 2 },
    );
  }
}

function songFixture(title: string) {
  return {
    title,
    artist: 'Acceptance Suite',
    key: 'C',
    bpm: 100,
    durationSec: 180,
    status: 'active' as const,
    body: `{title: ${title}}\n{start_of_verse}\n[C]la la la[C]\n{end_of_verse}`,
  };
}

test('dragging a song from the pool into the setlist inserts it where it was dropped, not always at the end', async ({ page }) => {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'setlist-drag-drop');
  const setup = connectTestBandDoc(bandId, token);
  await setup.waitForSynced();

  const setlistId = createSetlist(setup.doc, 'Drag Drop Test');
  const setlistSongTitles = ['Amazing Grace', 'Auld Lang Syne', 'House of the Rising Sun', 'Shenandoah'];
  for (const title of setlistSongTitles) {
    const songId = addSong(setup.doc, songFixture(title));
    addSetlistItem(setup.doc, setlistId, buildSongItem(songId));
  }
  // Stays in the band's repertoire pool, never added to the setlist above —
  // this is the song the test drags in.
  addSong(setup.doc, songFixture('Scarborough Fair'));
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/setlists/${setlistId}`);
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.waitForSelector('text=Repertoire');

    const setlistItems = page.locator('.border-dashed li');
    await expect(setlistItems).toHaveCount(4);

    // "Scarborough Fair" (in the pool, not yet in this setlist) dragged
    // onto the setlist's 2nd item ("Auld Lang Syne") should land as the
    // new 2nd item — not appended at the end regardless of drop position,
    // which was the bug. Grabbed near its left edge, never on the "Add to
    // end" button on the right (present only after this fix, but this
    // point works identically before it too, when the whole row dragged).
    const poolCard = page.locator('li', { hasText: 'Scarborough Fair' }).first();
    const secondItem = setlistItems.nth(1);
    await dragTo(page, await leftEdgePoint(poolCard), await leftEdgePoint(secondItem));

    // The insertion marker should be visible mid-drag, showing where the
    // drop will land, before the drop actually happens.
    await expect(page.getByTestId('setlist-insertion-marker')).toBeVisible();

    await page.mouse.up();

    await expect(setlistItems).toHaveCount(5);
    const labels = await setlistItems.allTextContents();
    expect(labels[0]).toContain('Amazing Grace');
    expect(labels[1]).toContain('Scarborough Fair');
    expect(labels[2]).toContain('Auld Lang Syne');
    expect(labels[3]).toContain('House of the Rising Sun');
    expect(labels[4]).toContain('Shenandoah');

    // Reordering an existing setlist item still works (unchanged code
    // path, not touched by this fix) — drag "Shenandoah" (currently last)
    // up towards the front. dnd-kit live-previews sortable-to-sortable
    // drags by reflowing the other rows as you cross them, which is real,
    // correct behavior but makes the exact landing index sensitive to
    // this test's synthetic pointer speed/step count — so this only
    // asserts it moved substantially earlier, not a specific index.
    const firstItem = setlistItems.nth(0);
    const shenandoahItem = page.locator('.border-dashed li', { hasText: 'Shenandoah' });
    await dragTo(page, await leftEdgePoint(shenandoahItem), await leftEdgePoint(firstItem));
    await page.mouse.up();

    const reorderedLabels = await setlistItems.allTextContents();
    const shenandoahIndex = reorderedLabels.findIndex((label) => label.includes('Shenandoah'));
    expect(shenandoahIndex).toBeGreaterThanOrEqual(0);
    expect(shenandoahIndex).toBeLessThan(4);
  } finally {
    await deleteThrowawayBand(token, bandId);
    setup.provider.destroy();
  }
});
