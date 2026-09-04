// SPDX-License-Identifier: Apache-2.0
//
// The band switcher used to only update a global store — every band-scoped
// page reads its band id from the URL, so switching had no effect at all
// until you navigated away and back by hand. One test per affected page,
// each seeded with content that only exists in one of two throwaway bands,
// proving the new band's content actually appears and the old band's
// doesn't (not just that the URL changed).
import { addSetlistItem, addSong, buildSongItem, createEvent, createPoll, createSetlist } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import {
  createThrowawayBand,
  DEMO_OWNER_EMAIL,
  DEMO_PASSWORD,
  deleteThrowawayBand,
  login,
  switchBand,
} from './fixtures';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

test.describe('switching bands updates every band-scoped page immediately', () => {
  let ownerToken: string;
  let bandA: { bandId: string; name: string };
  let bandB: { bandId: string; name: string };
  let setlistIdA: string;
  let eventIdA: string;
  let pollIdA: string;

  test.beforeAll(async () => {
    ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
    bandA = await createThrowawayBand(ownerToken, 'band-switch-a');
    bandB = await createThrowawayBand(ownerToken, 'band-switch-b');

    const setupA = connectTestBandDoc(bandA.bandId, ownerToken);
    await setupA.waitForSynced();
    addSong(setupA.doc, {
      title: 'Song Only In Band A',
      artist: 'Acceptance Suite',
      key: 'C',
      bpm: 100,
      durationSec: 180,
      status: 'active',
      body: '{title: Song Only In Band A}\n[C]lyrics',
    });
    setlistIdA = createSetlist(setupA.doc, 'Setlist Only In Band A');
    const songForSetlistA = addSong(setupA.doc, {
      title: 'Second Song A',
      artist: 'Acceptance Suite',
      key: 'C',
      bpm: 100,
      durationSec: 120,
      status: 'active',
      body: '',
    });
    addSetlistItem(setupA.doc, setlistIdA, buildSongItem(songForSetlistA));
    eventIdA = createEvent(setupA.doc, {
      type: 'rehearsal',
      title: 'Event Only In Band A',
      startsAt: Date.now() + 1000 * 60 * 60 * 24,
      allDay: false,
      status: 'confirmed',
    });
    pollIdA = createPoll(setupA.doc, {
      title: 'Poll Only In Band A',
      options: [{ startsAt: Date.now() + 1000 * 60 * 60 * 24 }],
    });
    await flush();
    setupA.provider.destroy();

    const setupB = connectTestBandDoc(bandB.bandId, ownerToken);
    await setupB.waitForSynced();
    addSong(setupB.doc, {
      title: 'Song Only In Band B',
      artist: 'Acceptance Suite',
      key: 'D',
      bpm: 110,
      durationSec: 180,
      status: 'active',
      body: '{title: Song Only In Band B}\n[D]lyrics',
    });
    const setlistIdB = createSetlist(setupB.doc, 'Setlist Only In Band B');
    const songForSetlistB = addSong(setupB.doc, {
      title: 'Second Song B',
      artist: 'Acceptance Suite',
      key: 'D',
      bpm: 110,
      durationSec: 120,
      status: 'active',
      body: '',
    });
    addSetlistItem(setupB.doc, setlistIdB, buildSongItem(songForSetlistB));
    createEvent(setupB.doc, {
      type: 'rehearsal',
      title: 'Event Only In Band B',
      startsAt: Date.now() + 1000 * 60 * 60 * 24,
      allDay: false,
      status: 'confirmed',
    });
    await flush();
    setupB.provider.destroy();
  });

  test.afterAll(async () => {
    await deleteThrowawayBand(ownerToken, bandA.bandId);
    await deleteThrowawayBand(ownerToken, bandB.bandId);
  });

  test('Repertoire', async ({ page }) => {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandA.bandId}/repertoire`);
    await expect(page.getByText('Song Only In Band A')).toBeVisible();

    await switchBand(page, page.getByLabel('Active band'), bandB.name);
    await expect(page).toHaveURL(new RegExp(`/bands/${bandB.bandId}/repertoire$`));
    await expect(page.getByText('Song Only In Band B')).toBeVisible();
    await expect(page.getByText('Song Only In Band A')).not.toBeVisible();
  });

  test('Setlists', async ({ page }) => {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandA.bandId}/setlists`);
    await expect(page.getByText('Setlist Only In Band A')).toBeVisible();

    await switchBand(page, page.getByLabel('Active band'), bandB.name);
    await expect(page).toHaveURL(new RegExp(`/bands/${bandB.bandId}/setlists$`));
    await expect(page.getByText('Setlist Only In Band B')).toBeVisible();
    await expect(page.getByText('Setlist Only In Band A')).not.toBeVisible();
  });

  test('Calendar', async ({ page }) => {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandA.bandId}/calendar`);
    await expect(page.getByText('Event Only In Band A')).toBeVisible();

    await switchBand(page, page.getByLabel('Active band'), bandB.name);
    await expect(page).toHaveURL(new RegExp(`/bands/${bandB.bandId}/calendar$`));
    await expect(page.getByText('Event Only In Band B')).toBeVisible();
    await expect(page.getByText('Event Only In Band A')).not.toBeVisible();
  });

  test('Band settings', async ({ page }) => {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandA.bandId}/settings`);
    // getByText would also match the band switcher's own trigger, which
    // shows the current band's name as its value — scope to the page's
    // actual heading instead.
    await expect(page.getByRole('heading', { name: bandA.name })).toBeVisible();

    await switchBand(page, page.getByLabel('Active band'), bandB.name);
    await expect(page).toHaveURL(new RegExp(`/bands/${bandB.bandId}/settings$`));
    await expect(page.getByRole('heading', { name: bandB.name })).toBeVisible();
    await expect(page.getByRole('heading', { name: bandA.name })).not.toBeVisible();
  });

  test('Dashboard', async ({ page }) => {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandA.bandId}/dashboard`);
    // Band A has 2 songs seeded above (the repertoire fixture + the setlist's own song), Band B also has 2 — use the URL itself plus a page reachable only from the *current* band's nav as the distinguishing signal instead of the song count, which is identical by design here.
    await expect(page).toHaveURL(new RegExp(`/bands/${bandA.bandId}/dashboard$`));

    await switchBand(page, page.getByLabel('Active band'), bandB.name);
    await expect(page).toHaveURL(new RegExp(`/bands/${bandB.bandId}/dashboard$`));

    // The Repertoire link (built from the URL's own band id, not stale global state) should now point at band B.
    const href = await page.getByRole('link', { name: 'Repertoire' }).getAttribute('href');
    expect(href).toBe(`/bands/${bandB.bandId}/repertoire`);
  });

  test('switching away from a specific setlist lands on the new band\'s Setlists overview, not an error', async ({ page }) => {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandA.bandId}/setlists/${setlistIdA}`);
    await expect(page.getByRole('heading', { name: 'Setlist Only In Band A' })).toBeVisible();

    await switchBand(page, page.getByLabel('Active band'), bandB.name);
    await expect(page).toHaveURL(new RegExp(`/bands/${bandB.bandId}/setlists$`));
    await expect(page.getByText('Setlist Only In Band B')).toBeVisible();
  });

  test('switching away from a specific event lands on the new band\'s Calendar, not an error', async ({ page }) => {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandA.bandId}/calendar/${eventIdA}`);
    await expect(page.getByRole('heading', { name: 'Event Only In Band A' })).toBeVisible();

    await switchBand(page, page.getByLabel('Active band'), bandB.name);
    await expect(page).toHaveURL(new RegExp(`/bands/${bandB.bandId}/calendar$`));
    await expect(page.getByText('Event Only In Band B')).toBeVisible();
  });

  test('switching away from a specific poll lands on the new band\'s Calendar, not an error', async ({ page }) => {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandA.bandId}/polls/${pollIdA}`);
    await expect(page.getByRole('heading', { name: 'Poll Only In Band A' })).toBeVisible();

    await switchBand(page, page.getByLabel('Active band'), bandB.name);
    await expect(page).toHaveURL(new RegExp(`/bands/${bandB.bandId}/calendar$`));
  });

  test('switching away from a specific song editor lands on the new band\'s Repertoire, not an error', async ({ page }) => {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandA.bandId}/repertoire`);
    await page.getByRole('link', { name: /Edit Song Only In Band A/ }).click();
    await expect(page).toHaveURL(/\/songs\/.+\/edit$/);

    await switchBand(page, page.getByLabel('Active band'), bandB.name);
    await expect(page).toHaveURL(new RegExp(`/bands/${bandB.bandId}/repertoire$`));
    await expect(page.getByText('Song Only In Band B')).toBeVisible();
  });
});
