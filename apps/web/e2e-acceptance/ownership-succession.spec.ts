// SPDX-License-Identifier: Apache-2.0
//
// The owner used to be blocked from leaving at all until they transferred
// ownership manually. Leaving now transfers ownership automatically to the
// highest-ranked remaining member, and names that member in the
// confirmation dialog before the owner commits — see
// docs/adr/0005-permissions.md and BandSettings.tsx's handleLeave.
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, freshEmail, login } from './fixtures';
import { signInForToken, signUpForToken } from './hocuspocusTestClient';

const SERVER_URL = process.env.VITE_DEFAULT_SERVER_URL ?? 'http://localhost:3001';

test('the owner leaving is told who takes over, and that member becomes the new owner', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'ownership-succession');
  const admin = await signUpForToken('Future Owner Admin', freshEmail('future-owner'), DEMO_PASSWORD);

  const inviteRes = await fetch(`${SERVER_URL}/bands/${bandId}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ label: 'test-future-owner', role: 'admin' }),
  });
  const { code } = (await inviteRes.json()) as { code: string };
  await fetch(`${SERVER_URL}/invites/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({ code }),
  });

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/settings`);

    await page.getByRole('button', { name: 'Leave band' }).click();

    // Leaving as owner now goes through the app's own styled confirm
    // dialog (ConfirmDialog/useConfirmDialog), not a native window.confirm
    // — scoped to the dialog itself since its own confirm action is also
    // labeled "Leave band", same as the trigger button behind it.
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Future Owner Admin')).toBeVisible();
    await dialog.getByRole('button', { name: 'Leave band' }).click();

    await page.waitForURL(/\/dashboard/);

    const membersRes = await fetch(`${SERVER_URL}/bands/${bandId}/members`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const members = (await membersRes.json()) as { userId: string; role: string }[];
    expect(members.find((m) => m.userId === admin.userId)?.role).toBe('owner');
  } finally {
    // The band now belongs to the new owner — clean it up with their token.
    await deleteThrowawayBand(admin.token, bandId);
  }
});
