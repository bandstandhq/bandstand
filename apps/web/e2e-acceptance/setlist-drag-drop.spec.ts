// SPDX-License-Identifier: Apache-2.0
//
// A fresh, throwaway setlist (never a name any other acceptance test
// reuses) — this test mutates it freely via real drag gestures and deletes
// it afterward, rather than adding to the "Open Mic Night"/"Full Band
// Practice Set" setlists other tests and a developer's own manual testing
// rely on staying recognizable (see issue #81's finding on shared-fixture
// pollution).
import { addSetlistItem, buildSongItem, createSetlist } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import { DEMO_OWNER_EMAIL, login } from './fixtures';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';
import { getBandIdBySlug, withDb } from './testDb';

const SERVER_URL = process.env.VITE_DEFAULT_SERVER_URL ?? 'http://localhost:3001';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

/** Setlist deletion is a REST route, not a plain CRDT write (see docs/adr/0005-permissions.md) — a raw `deleteSetlist(doc, ...)` from this test's own direct Yjs connection would just get reverted by the server's own permission guard. */
async function deleteSetlistViaApi(token: string, bandId: string, setlistId: string) {
  await fetch(`${SERVER_URL}/bands/${bandId}/setlists/${setlistId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
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

test('dragging a song from the pool into the setlist inserts it where it was dropped, not always at the end', async ({ page }) => {
  const bandId = await withDb((client) => getBandIdBySlug(client, 'demo-band'));
  const token = await signInForToken(DEMO_OWNER_EMAIL, 'bandstand-demo');
  const setup = connectTestBandDoc(bandId, token);
  await setup.waitForSynced();

  const setlistId = createSetlist(setup.doc, `Drag Drop Test ${Date.now()}`);
  const songIds = ['song-amazing-grace', 'song-auld-lang-syne', 'song-house-of-the-rising-sun', 'song-shenandoah'];
  for (const songId of songIds) addSetlistItem(setup.doc, setlistId, buildSongItem(songId));
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
    await deleteSetlistViaApi(token, bandId, setlistId);
    setup.provider.destroy();
  }
});
