// SPDX-License-Identifier: Apache-2.0
//
// A mobile-usability regression guard: every main page, at three device
// profiles, must never force the document wider than the viewport (no
// horizontal scrolling — see docs/... mobile-usability pass). Content is
// deliberately long (song title, event location, poll title, setlist name,
// band name) so a page that only "happens" to fit with short seeded
// content still gets caught if it can't handle a realistic long value.
// Each test owns its own throwaway band (issue #81 — no acceptance spec
// reads or writes demo-band/second-fiddle's own content).
import { addSong, addSetlistItem, buildSongItem, createEvent, createPoll, createSetlist } from '@bandstand/core';
import { type Page, expect, test } from '@playwright/test';
import {
  createThrowawayBand,
  DEMO_MEMBER_EMAIL,
  DEMO_OWNER_EMAIL,
  DEMO_PASSWORD,
  deleteThrowawayBand,
  login,
} from './fixtures';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';
import { addBandMember, getUserIdByEmail, withDb } from './testDb';

const SERVER_URL = process.env.VITE_DEFAULT_SERVER_URL ?? 'http://localhost:3001';

const LONG_SONG_TITLE =
  'A Really Very Extremely Long Song Title That Should Wrap Instead Of Breaking The Whole Page Layout';
const LONG_LOCATION =
  'An Extremely Long Venue Name And Street Address That Could Easily Overflow A Narrow Mobile Screen, 1234 Some Long Street, Some City';
const LONG_POLL_TITLE = 'When Should We Rehearse Before The Absolutely Enormous Once-In-A-Lifetime Reunion Gig';
const LONG_SETLIST_NAME = 'The Complete Three-Set Reunion Show With Every Encore We Have Ever Played';
const LONG_BAND_NAME = 'The Extremely Long Band Name That Should Never Break This Page Layout On A Phone';

const PROFILES = [
  { name: 'phone-portrait', width: 360, height: 800 },
  { name: 'phone-landscape', width: 800, height: 360 },
  { name: 'tablet', width: 768, height: 1024 },
] as const;

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

async function assertNoHorizontalOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth, `${label}: document is wider than the viewport`).toBeLessThanOrEqual(metrics.innerWidth);
}

test.describe('mobile usability: no page scrolls horizontally', () => {
  for (const profile of PROFILES) {
    test(`at ${profile.name} (${profile.width}x${profile.height})`, async ({ page }) => {
      test.setTimeout(60_000);
      const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
      const { bandId } = await createThrowawayBand(ownerToken, `mobile-usability-${profile.name}`);
      try {
        await withDb(async (client) => {
          const bobUserId = await getUserIdByEmail(client, DEMO_MEMBER_EMAIL);
          await addBandMember(client, bandId, bobUserId);
        });

        await fetch(`${SERVER_URL}/bands/${bandId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
          body: JSON.stringify({ name: LONG_BAND_NAME }),
        });

        const setup = connectTestBandDoc(bandId, ownerToken);
        await setup.waitForSynced();
        const songId = addSong(setup.doc, {
          title: LONG_SONG_TITLE,
          artist: 'Traditional',
          key: 'G',
          bpm: 90,
          durationSec: 180,
          status: 'active',
          body: '{title: Song}\n[G]Some [C]lyrics [D]here',
        });
        const setlistId = createSetlist(setup.doc, LONG_SETLIST_NAME);
        const itemId = addSetlistItem(setup.doc, setlistId, buildSongItem(songId));
        const eventId = createEvent(setup.doc, {
          type: 'gig',
          title: 'Reunion Gig',
          startsAt: Date.now() + 1000 * 60 * 60 * 24 * 5,
          allDay: false,
          location: LONG_LOCATION,
          status: 'confirmed',
        });
        const pollId = createPoll(setup.doc, {
          title: LONG_POLL_TITLE,
          options: [{ startsAt: Date.now() + 1000 * 60 * 60 * 24 * 3 }, { startsAt: Date.now() + 1000 * 60 * 60 * 24 * 10 }],
        });
        await flush();

        await page.setViewportSize({ width: profile.width, height: profile.height });
        await login(page, DEMO_OWNER_EMAIL);

        const staticPages: { path: string; extra?: () => Promise<void> }[] = [
          // Not the bare /dashboard — it only resolves which band to show
          // and forwards there (DashboardRedirect), and which band it picks
          // for an owner who's also in the seeded demo bands isn't
          // deterministic. Going straight to this band's own dashboard is
          // what actually exercises the long band name in the switcher.
          { path: `/bands/${bandId}/dashboard` },
          { path: `/bands/${bandId}/repertoire` },
          { path: `/bands/${bandId}/songs/${songId}/edit` },
          { path: `/bands/${bandId}/songs/${songId}/play` },
          { path: `/bands/${bandId}/setlists` },
          { path: `/bands/${bandId}/setlists/${setlistId}` },
          {
            path: `/bands/${bandId}/setlists/${setlistId}`,
            extra: async () => {
              await page.getByRole('button', { name: 'Edit' }).click();
            },
          },
          { path: `/bands/${bandId}/setlists/${setlistId}/stage/${itemId}` },
          { path: `/bands/${bandId}/calendar` },
          {
            path: `/bands/${bandId}/calendar`,
            extra: async () => {
              await page.getByRole('button', { name: 'Month view' }).click();
            },
          },
          { path: `/bands/${bandId}/calendar/${eventId}` },
          { path: `/bands/${bandId}/polls/${pollId}` },
          { path: `/bands/${bandId}/settings` },
        ];

        for (const { path, extra } of staticPages) {
          await page.goto(path, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(300);
          if (extra) {
            await extra();
            await page.waitForTimeout(300);
          }
          await assertNoHorizontalOverflow(page, `${profile.name} ${path}${extra ? ' (+action)' : ''}`);
        }
      } finally {
        await deleteThrowawayBand(ownerToken, bandId);
      }
    });
  }
});
