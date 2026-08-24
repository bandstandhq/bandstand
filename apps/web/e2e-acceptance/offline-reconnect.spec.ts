// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';
import { DEMO_MEMBER_EMAIL, DEMO_OWNER_EMAIL, freshName, getActiveBandId, login } from './fixtures';

test('an edit made while offline reaches other clients once reconnected', async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const alice = await aliceContext.newPage();

  try {
    await login(alice, DEMO_OWNER_EMAIL);
    const bandId = await getActiveBandId(alice);
    await alice.goto(`/bands/${bandId}/setlists`);

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
  }
});
