// SPDX-License-Identifier: Apache-2.0
//
// Regression test for: tapping "Create setlist" (or "Add to end"/"Add
// break"/"Add finale" from a setlist's edit view) did nothing at all if the
// band's Yjs doc hadn't finished loading yet — useBandDoc.ts's `doc` starts
// out `null` and both handleCreate/handleAddToEnd silently no-op on it. That
// window is longer on a slower or just-reconnecting mobile connection, and
// with no loading indication it looked exactly like a broken button. Delays
// both paths that can set `doc` (the REST membership check useBandDoc.ts
// falls back on, and the Hocuspocus WebSocket's own sync) to hold the app in
// that "still connecting" state on demand.
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { signInForToken } from './hocuspocusTestClient';

test('setlist actions are disabled with a clear reason while the band doc is still connecting, and work once it loads', async ({
  page,
}) => {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'setlist-wait-for-doc');

  let releaseMembershipCheck: () => void = () => {};
  const membershipCheckHeld = new Promise<void>((resolve) => {
    releaseMembershipCheck = resolve;
  });

  try {
    // Holds the REST fallback path open indefinitely until released below.
    await page.route(`**/bands/${bandId}/members`, async (route) => {
      await membershipCheckHeld;
      await route.continue();
    });
    // Intercepts the Hocuspocus connection without ever relaying real sync
    // traffic — the client's WebSocket opens, but no Yjs sync-step message
    // ever arrives, so `synced` (the other path that sets `doc`) never
    // fires either. Never explicitly closed, so this alone doesn't flip
    // `status` to 'offline' underneath the assertions below.
    await page.routeWebSocket(/:3002\//, () => {});

    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/setlists`);

    await expect(page.getByText('Connecting', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create setlist' })).toBeDisabled();
    await page.getByPlaceholder('Setlist name').fill('Should Not Appear Yet');

    // Releasing the held REST call is enough on its own for the band-list
    // page — its handleCreate only needs `doc`, not a fully 'connected'
    // status. The buttons must now be usable, with no leftover "connecting"
    // text or need for a page reload.
    releaseMembershipCheck();
    await expect(page.getByText('Connecting', { exact: false })).not.toBeVisible();
    const createButton = page.getByRole('button', { name: 'Create setlist' });
    await expect(createButton).toBeEnabled();
    await createButton.click();

    await expect(page.getByText('Should Not Appear Yet')).toBeVisible();
  } finally {
    await deleteThrowawayBand(token, bandId);
  }
});
