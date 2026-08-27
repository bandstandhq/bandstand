// SPDX-License-Identifier: Apache-2.0
//
// See docs/adr/0011-calendar-events.md. Each test owns its own throwaway
// band (issue #81 — no acceptance spec reads or writes demo-band/
// second-fiddle's own content).
import { createEvent, createPoll, listPolls } from '@bandstand/core';
import { expect, test } from '@playwright/test';
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

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

async function setupThrowawayBandWithBob(namePrefix: string) {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, namePrefix);
  await withDb(async (client) => {
    const bobUserId = await getUserIdByEmail(client, DEMO_MEMBER_EMAIL);
    await addBandMember(client, bandId, bobUserId);
  });
  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();
  return { ownerToken, bandId, setup };
}

async function gotoEventDetail(page: import('@playwright/test').Page, bandId: string, eventId: string) {
  await page.goto(`/bands/${bandId}/calendar/${eventId}`);
}

test('responding to availability is visible to every band member, and only your own row is changeable', async ({ browser }) => {
  const { ownerToken, bandId, setup } = await setupThrowawayBandWithBob('calendar-availability');
  try {
    const eventId = createEvent(setup.doc, {
      type: 'rehearsal',
      title: 'Availability Test Rehearsal',
      startsAt: Date.now() + 1000 * 60 * 60 * 24 * 5,
      allDay: false,
      status: 'confirmed',
    });
    await flush();

    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alice = await aliceContext.newPage();
    const bob = await bobContext.newPage();
    try {
      await login(alice, DEMO_OWNER_EMAIL);
      await login(bob, DEMO_MEMBER_EMAIL);
      await gotoEventDetail(alice, bandId, eventId);
      await gotoEventDetail(bob, bandId, eventId);

      // Alice answers her own row.
      await alice.getByRole('listitem').filter({ hasText: 'Alice' }).getByRole('button', { name: 'Yes' }).click();
      await alice.waitForTimeout(600);

      // Bob's page (a completely separate session) sees Alice's answer,
      // but her row has no vote buttons for him to press — only his own does.
      const aliceRowOnBobsScreen = bob.getByRole('listitem').filter({ hasText: 'Alice' });
      await expect(aliceRowOnBobsScreen.getByText('Yes')).toBeVisible({ timeout: 5000 });
      await expect(aliceRowOnBobsScreen.getByRole('button', { name: 'Yes' })).toHaveCount(0);
      await expect(aliceRowOnBobsScreen.getByRole('button', { name: 'Maybe' })).toHaveCount(0);
      await expect(aliceRowOnBobsScreen.getByRole('button', { name: 'No' })).toHaveCount(0);

      // Bob's own row does have them, and answering changes only his row.
      const bobRowOnBobsScreen = bob.getByRole('listitem').filter({ hasText: 'Bob' });
      await expect(bobRowOnBobsScreen.getByRole('button', { name: 'Maybe' })).toBeVisible();
      await bobRowOnBobsScreen.getByRole('button', { name: 'Maybe' }).click();
      await bob.waitForTimeout(600);
      await expect(bobRowOnBobsScreen.getByText('Maybe')).toBeVisible();
      // Alice's row is unaffected by Bob's own answer.
      await expect(aliceRowOnBobsScreen.getByText('Yes')).toBeVisible();
    } finally {
      await aliceContext.close();
      await bobContext.close();
    }
  } finally {
    await deleteThrowawayBand(ownerToken, bandId);
    setup.provider.destroy();
  }
});

test('an admin closing a poll creates the winning option as a real event, linked back from the poll', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'calendar-poll-close');
  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();

  const pollId = createPoll(setup.doc, {
    title: 'Acceptance Poll',
    options: [{ startsAt: Date.now() + 1000 * 60 * 60 * 24 * 8 }, { startsAt: Date.now() + 1000 * 60 * 60 * 24 * 9 }],
  });
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/polls/${pollId}`);

    await page.getByRole('button', { name: 'Close this poll' }).click();
    await page.getByPlaceholder('Event title').fill('Acceptance Poll Result');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForURL(/\/calendar\//);
    await expect(page.getByRole('heading', { name: 'Acceptance Poll Result' })).toBeVisible();

    // The poll itself now shows as closed, linking back to that same event.
    await page.goto(`/bands/${bandId}/polls/${pollId}`);
    await expect(page.getByText('This poll is closed.')).toBeVisible();
    await page.getByRole('link', { name: 'View the event' }).click();
    await expect(page.getByRole('heading', { name: 'Acceptance Poll Result' })).toBeVisible();

    const poll = listPolls(setup.doc)[pollId];
    expect(poll?.resolvedEventId).toBeTruthy();
  } finally {
    await deleteThrowawayBand(ownerToken, bandId);
    setup.provider.destroy();
  }
});

test('the ICS feed serves valid data for a real token and 404s a wrong one', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'calendar-ics');
  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();

  createEvent(setup.doc, {
    type: 'gig',
    title: 'ICS Acceptance Gig',
    startsAt: Date.now() + 1000 * 60 * 60 * 24 * 15,
    allDay: false,
    status: 'confirmed',
    location: 'Acceptance Venue',
  });

  try {
    const tokenRes = await fetch(`${SERVER_URL}/me/ics-token`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    expect(tokenRes.ok).toBe(true);
    const { token } = (await tokenRes.json()) as { token: string };

    // The feed reads from Postgres's band_docs.snapshot, which Hocuspocus
    // only writes after its own debounce (up to several seconds, see
    // hocuspocus.ts) — poll rather than assert immediately after the
    // in-memory doc edit above.
    let body = '';
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      const feedRes = await page.request.get(`${SERVER_URL}/calendar/${token}.ics`);
      expect(feedRes.status()).toBe(200);
      expect(feedRes.headers()['content-type']).toContain('text/calendar');
      body = await feedRes.text();
      if (body.includes('ICS Acceptance Gig')) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('ICS Acceptance Gig');

    const badRes = await page.request.get(`${SERVER_URL}/calendar/not-a-real-token.ics`, { failOnStatusCode: false });
    expect(badRes.status()).toBe(404);
  } finally {
    await deleteThrowawayBand(ownerToken, bandId);
    setup.provider.destroy();
  }
});
