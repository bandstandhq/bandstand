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

/** A point near the left edge of a row's box — lands on its drag handle (the leftmost element in both the pool and the setlist), never on a right-aligned action button. */
async function leftEdgePoint(locator: import('@playwright/test').Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Could not measure element for drag point');
  return { x: box.x + 20, y: box.y + box.height / 2 };
}

/** A point past the row's padding + drag handle (p-2 + w-8 + gap-1 ≈ 44px) — lands on the row's label/tap target instead, never on the handle itself. */
async function labelPoint(locator: import('@playwright/test').Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Could not measure element for click point');
  return { x: box.x + 55, y: box.y + box.height / 2 };
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

  let cdp: Awaited<ReturnType<import('@playwright/test').BrowserContext['newCDPSession']>> | undefined;
  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/setlists/${setlistId}`);
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.waitForSelector('text=Repertoire');

    // Deliberately slows this tab's main thread (CDP-level, Chromium only —
    // see playwright.acceptance.config.ts's single chromium project) to
    // reproduce the conditions of the app's real target hardware: an older
    // tablet on stage, not just a busy CI/dev machine. A sortable row here
    // is a real, natively-draggable <a> (React Router Link) doubling as a
    // dnd-kit drag handle; under a slow main thread the browser's own native
    // drag recognition can win the race against dnd-kit's synthetic pointer
    // tracking before dnd-kit's preventDefault applies, silently swallowing
    // the gesture — see docs/adr/0014-no-native-drag-on-interactive-rows.md.
    // Throttling starts only now, after login/setup, so it can't blow the
    // test timeout on unrelated steps.
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });

    // A permanent regression guard, not a one-off diagnostic: 'drag'/
    // 'dragend' only ever fire if a real native browser drag session
    // actually started (unlike 'dragstart', which fires on mere attempt and
    // says nothing about who won the race). If either ever fires again,
    // the native-drag-vs-dnd-kit race is back.
    await page.evaluate(() => {
      (window as unknown as { __nativeDragEvents: string[] }).__nativeDragEvents = [];
      for (const type of ['drag', 'dragend']) {
        document.addEventListener(type, () => (window as unknown as { __nativeDragEvents: string[] }).__nativeDragEvents.push(type));
      }
    });

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

    const nativeDragEvents = await page.evaluate(() => (window as unknown as { __nativeDragEvents: string[] }).__nativeDragEvents);
    expect(nativeDragEvents).toEqual([]);
  } finally {
    await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await deleteThrowawayBand(token, bandId);
    setup.provider.destroy();
  }
});

test('a real click on a setlist row still navigates to Stage Mode after that row was just dragged', async ({ page }) => {
  // Regression test for the click-suppression backstop in SortableSetlistItem
  // (see docs/adr/0014-no-native-drag-on-interactive-rows.md): it must
  // swallow exactly the one click that a drag's own mouseup produces, never
  // any click after it. No throttling needed here — this isn't about the
  // race under load, it's about the suppression flag's own lifecycle.
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'setlist-drag-drop-click-after');
  const setup = connectTestBandDoc(bandId, token);
  await setup.waitForSynced();

  const setlistId = createSetlist(setup.doc, 'Click After Drag Test');
  for (const title of ['Amazing Grace', 'Auld Lang Syne']) {
    const songId = addSong(setup.doc, songFixture(title));
    addSetlistItem(setup.doc, setlistId, buildSongItem(songId));
  }
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/setlists/${setlistId}`);
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.waitForSelector('text=Repertoire');

    const setlistItems = page.locator('.border-dashed li');
    await expect(setlistItems).toHaveCount(2);

    // Drag the second item onto the first — a real reorder, so the
    // suppression ref does get armed by an actual recognized drag-start,
    // not skipped because nothing happened.
    const firstItem = setlistItems.nth(0);
    const secondItem = setlistItems.nth(1);
    await dragTo(page, await leftEdgePoint(secondItem), await leftEdgePoint(firstItem));
    await page.mouse.up();

    // The drag's own mouseup may or may not have produced a click that got
    // suppressed — either way, the row is idle now. A separate, later click
    // (no drag movement at all) on that same row must go through normally.
    // A plain `locator.click()` here would navigate away mid-action and then
    // spin retrying against a locator that no longer resolves on the new
    // page — a raw coordinate click sidesteps that entirely, the same way
    // dragTo() already does for the drag itself.
    const targetRow = page.locator('.border-dashed li').first();
    const { x, y } = await labelPoint(targetRow);
    await Promise.all([page.waitForURL(/\/stage\//), page.mouse.click(x, y)]);
  } finally {
    await deleteThrowawayBand(token, bandId);
    setup.provider.destroy();
  }
});

/**
 * A real touch drag via CDP's Input.dispatchTouchEvent — page.mouse (used by
 * dragTo above) sends pointerType 'mouse' even in a hasTouch context, so it
 * never exercises TouchSensor at all. Holds still past dnd-kit's 200ms
 * activation delay before moving, matching how TouchSensor tells an
 * intentional drag apart from the start of a page scroll.
 */
async function touchDragTo(
  cdp: Awaited<ReturnType<import('@playwright/test').BrowserContext['newCDPSession']>>,
  fromPoint: { x: number; y: number },
  toPoint: { x: number; y: number },
) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [fromPoint] });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const point = {
      x: fromPoint.x + ((toPoint.x - fromPoint.x) * i) / steps,
      y: fromPoint.y + ((toPoint.y - fromPoint.y) * i) / steps,
    };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

async function touchDrop(cdp: Awaited<ReturnType<import('@playwright/test').BrowserContext['newCDPSession']>>) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('dragging a song from the pool into the setlist works via a real touch gesture, not just a mouse', async ({ browser }) => {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'setlist-drag-drop-touch');
  const setup = connectTestBandDoc(bandId, token);
  await setup.waitForSynced();

  const setlistId = createSetlist(setup.doc, 'Touch Drag Test');
  addSong(setup.doc, songFixture('Scarborough Fair'));
  await flush();

  // A narrow, touch-capable context — on this layout the pool sits above the
  // setlist (single-column below the `lg` breakpoint), so this also
  // exercises dragging across a real scroll distance, not just within one
  // already-visible section.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/setlists/${setlistId}`);
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.waitForSelector('text=Repertoire');

    const setlistItems = page.locator('.border-dashed li');
    await expect(setlistItems).toHaveCount(0);

    const poolHandle = page.getByTestId('pool-drag-handle');
    const dropZone = page.locator('.border-dashed');
    const from = await leftEdgePoint(poolHandle);
    const to = await leftEdgePoint(dropZone);

    await touchDragTo(cdp, from, to);
    await expect(page.getByTestId('setlist-insertion-marker')).toBeVisible();
    await touchDrop(cdp);

    await expect(setlistItems).toHaveCount(1);
    await expect(setlistItems.first()).toContainText('Scarborough Fair');
  } finally {
    await context.close();
    await deleteThrowawayBand(token, bandId);
    setup.provider.destroy();
  }
});

test('a touch starting on a row\'s label, not its drag handle, never starts a drag — so a scroll swipe there still reaches the browser', async ({
  browser,
}) => {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'setlist-drag-drop-touch-label');
  const setup = connectTestBandDoc(bandId, token);
  await setup.waitForSynced();

  const setlistId = createSetlist(setup.doc, 'Touch Label Test');
  addSong(setup.doc, songFixture('Scarborough Fair'));
  await flush();

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/setlists/${setlistId}`);
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.waitForSelector('text=Repertoire');

    const setlistItems = page.locator('.border-dashed li');
    await expect(setlistItems).toHaveCount(0);

    // Starting the same drag gesture from the *label* text next to the
    // handle (not the handle itself, see leftEdgePoint vs labelPoint) —
    // only the handle carries dnd-kit's listeners and touch-action:none
    // now, so this must never be recognized as a drag. If it were, this
    // test would see the insertion marker and a new setlist item, exactly
    // the regression this fix closes: previously the whole row was the
    // drag surface, so a scroll swipe starting anywhere on it (which is
    // most of the visible list) fought dnd-kit instead of reaching the
    // browser's native scroll.
    const poolCard = page.locator('li', { hasText: 'Scarborough Fair' }).first();
    const dropZone = page.locator('.border-dashed');
    const from = await labelPoint(poolCard);
    const to = await leftEdgePoint(dropZone);

    await touchDragTo(cdp, from, to);
    await expect(page.getByTestId('setlist-insertion-marker')).toHaveCount(0);
    await touchDrop(cdp);

    await expect(setlistItems).toHaveCount(0);
  } finally {
    await context.close();
    await deleteThrowawayBand(token, bandId);
    setup.provider.destroy();
  }
});

test('dropping a dragged pool song back outside the setlist adds nothing', async ({ page }) => {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'setlist-drag-drop-cancel');
  const setup = connectTestBandDoc(bandId, token);
  await setup.waitForSynced();

  const setlistId = createSetlist(setup.doc, 'Cancel Outside Test');
  const songId = addSong(setup.doc, songFixture('Amazing Grace'));
  addSetlistItem(setup.doc, setlistId, buildSongItem(songId));
  addSong(setup.doc, songFixture('Scarborough Fair'));
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/setlists/${setlistId}`);
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.waitForSelector('text=Repertoire');

    const setlistItems = page.locator('.border-dashed li');
    await expect(setlistItems).toHaveCount(1);

    // Grabbed, moved toward the setlist and back, then released over the
    // pool itself (a point with no droppable of its own) — this used to
    // still land the song at the top of the setlist regardless, since
    // closestCenter always resolves `over` to its nearest droppable even
    // when the release point isn't actually above one.
    const poolCard = page.locator('li', { hasText: 'Scarborough Fair' }).first();
    const poolPoint = await leftEdgePoint(poolCard);
    await dragTo(page, poolPoint, await leftEdgePoint(setlistItems.first()));
    await page.mouse.move(poolPoint.x, poolPoint.y, { steps: 4 });
    await page.mouse.up();

    await expect(setlistItems).toHaveCount(1);
    await expect(setlistItems.first()).toContainText('Amazing Grace');
  } finally {
    await deleteThrowawayBand(token, bandId);
    setup.provider.destroy();
  }
});

test('dragging a pool song below the last setlist item appends it at the end', async ({ page }) => {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'setlist-drag-drop-append');
  const setup = connectTestBandDoc(bandId, token);
  await setup.waitForSynced();

  const setlistId = createSetlist(setup.doc, 'Append At End Test');
  for (const title of ['Amazing Grace', 'Auld Lang Syne']) {
    const songId = addSong(setup.doc, songFixture(title));
    addSetlistItem(setup.doc, setlistId, buildSongItem(songId));
  }
  addSong(setup.doc, songFixture('Scarborough Fair'));
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/setlists/${setlistId}`);
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.waitForSelector('text=Repertoire');

    const setlistItems = page.locator('.border-dashed li');
    await expect(setlistItems).toHaveCount(2);

    // A point clearly below the last item's own box, but still inside the
    // drop zone's reserved trailing space — reachable only because of that
    // dedicated spacer, not a razor-thin sliver of leftover padding.
    const lastItemBox = await setlistItems.last().boundingBox();
    if (!lastItemBox) throw new Error('Could not measure last setlist item');
    const belowLastItem = { x: lastItemBox.x + 20, y: lastItemBox.y + lastItemBox.height + 30 };

    const poolCard = page.locator('li', { hasText: 'Scarborough Fair' }).first();
    await dragTo(page, await leftEdgePoint(poolCard), belowLastItem);
    await expect(page.getByTestId('setlist-insertion-marker')).toBeVisible();
    await page.mouse.up();

    await expect(setlistItems).toHaveCount(3);
    const labels = await setlistItems.allTextContents();
    expect(labels[2]).toContain('Scarborough Fair');
  } finally {
    await deleteThrowawayBand(token, bandId);
    setup.provider.destroy();
  }
});
