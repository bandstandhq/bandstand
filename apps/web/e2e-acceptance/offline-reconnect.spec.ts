// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';
import {
  createThrowawayBand,
  DEMO_MEMBER_EMAIL,
  DEMO_OWNER_EMAIL,
  DEMO_PASSWORD,
  deleteThrowawayBand,
  freshName,
  login,
} from './fixtures';
import { signInForToken } from './hocuspocusTestClient';
import { addBandMember, getUserIdByEmail, withDb } from './testDb';

test('an edit made while offline reaches other clients once reconnected', async ({ browser }) => {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'offline-reconnect');
  await withDb(async (client) => {
    const bobUserId = await getUserIdByEmail(client, DEMO_MEMBER_EMAIL);
    await addBandMember(client, bandId, bobUserId);
  });

  const aliceContext = await browser.newContext();
  const alice = await aliceContext.newPage();

  try {
    await login(alice, DEMO_OWNER_EMAIL);
    await alice.goto(`/bands/${bandId}/setlists`);
    // useBandDoc only reveals `doc` once either the Hocuspocus provider
    // fires 'synced' or the checkBandMembership REST call resolves — for a
    // brand-new browser session with no prior local membership record
    // (see docs/adr/0006-offline-cache-scoping.md), going offline before
    // that REST round trip completes would leave `doc` null and silently
    // no-op the "Create setlist" click below. A short pause here lets that
    // fast, same-origin call land first.
    await alice.waitForTimeout(500);

    const setlistName = freshName('offline-setlist');
    await aliceContext.setOffline(true);

    await alice.getByPlaceholder('Setlist name').fill(setlistName);
    await alice.getByRole('button', { name: 'Create setlist' }).click();
    // Yjs applies the change to the local doc immediately regardless of
    // connectivity — this is the offline-first guarantee, not the thing
    // being tested here.
    await expect(alice.getByText(setlistName)).toBeVisible();

    await aliceContext.setOffline(false);

    // A second, completely fresh session (no local cache of this band at
    // all) only ever sees a change once it has actually reached the
    // server — proving the offline edit really resynced, not just that
    // Alice's own tab remembers what it wrote.
    const bobContext = await browser.newContext();
    try {
      const bob = await bobContext.newPage();
      await login(bob, DEMO_MEMBER_EMAIL);
      await bob.goto(`/bands/${bandId}/setlists`);
      await expect(bob.getByText(setlistName)).toBeVisible({ timeout: 10000 });
    } finally {
      await bobContext.close();
    }
  } finally {
    await aliceContext.close();
    await deleteThrowawayBand(token, bandId);
  }
});
