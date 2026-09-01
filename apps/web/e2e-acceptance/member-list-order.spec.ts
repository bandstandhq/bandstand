// SPDX-License-Identifier: Apache-2.0
//
// The member list used to render in whatever order Postgres happened to
// return rows in (no ORDER BY) — jumping around after a role change or a
// member leaving. It's now sorted server-side: owner, then admin, then
// member, alphabetically by name within a role (see
// packages/core/src/permissions/roles.ts's compareMembersByRoleThenName).
// This proves BandSettings actually renders that order end to end.
import { expect, test } from '@playwright/test';
import type { BandRole } from '@bandstand/core';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, freshEmail, login } from './fixtures';
import { signInForToken, signUpForToken } from './hocuspocusTestClient';

const SERVER_URL = process.env.VITE_DEFAULT_SERVER_URL ?? 'http://localhost:3001';

async function inviteAndJoin(ownerToken: string, bandId: string, role: BandRole, memberToken: string) {
  const createRes = await fetch(`${SERVER_URL}/bands/${bandId}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ label: `test-${role}`, role }),
  });
  if (!createRes.ok) throw new Error(`Failed to create invite: ${createRes.status} ${await createRes.text()}`);
  const { code } = (await createRes.json()) as { code: string };

  const redeemRes = await fetch(`${SERVER_URL}/invites/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({ code }),
  });
  if (!redeemRes.ok) throw new Error(`Failed to redeem invite: ${redeemRes.status} ${await redeemRes.text()}`);
}

test('member list is sorted owner, then admin, then member, alphabetically by name within a role', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'member-list-order');

  // Deliberately out-of-order names within each role so a naive "insertion
  // order" default wouldn't accidentally pass.
  const zedAdmin = await signUpForToken('Zed Admin', freshEmail('zed-admin'), DEMO_PASSWORD);
  const annaAdmin = await signUpForToken('Anna Admin', freshEmail('anna-admin'), DEMO_PASSWORD);
  const yaraMember = await signUpForToken('Yara Member', freshEmail('yara-member'), DEMO_PASSWORD);
  const bobMember = await signUpForToken('Bob Member', freshEmail('bob-member'), DEMO_PASSWORD);

  await inviteAndJoin(ownerToken, bandId, 'admin', zedAdmin.token);
  await inviteAndJoin(ownerToken, bandId, 'admin', annaAdmin.token);
  await inviteAndJoin(ownerToken, bandId, 'member', yaraMember.token);
  await inviteAndJoin(ownerToken, bandId, 'member', bobMember.token);

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/settings`);
    // Force the wide (table) layout regardless of the viewport this runs
    // under, matching BandSettings.tsx's own `(max-width: 639px)` breakpoint.
    await page.setViewportSize({ width: 1024, height: 800 });

    const names = page.locator('table tbody tr td:first-child');
    await expect(names).toHaveText(['Alice', 'Anna Admin', 'Zed Admin', 'Bob Member', 'Yara Member']);
  } finally {
    await deleteThrowawayBand(ownerToken, bandId);
  }
});
