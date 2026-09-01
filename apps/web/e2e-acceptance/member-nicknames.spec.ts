// SPDX-License-Identifier: Apache-2.0
//
// A nickname is strictly private to whoever set it and replaces the real
// name everywhere a member's name is shown to that viewer — member list and
// availability here (see apps/server/src/routes/nicknames.ts and
// apps/web/src/hooks/useNicknames.ts). Follow Mode's own use of the same
// hook is covered by unit-level wiring, not re-verified here — driving two
// concurrent Stage Mode sessions just to read a label would duplicate
// follow-mode.spec.ts's own setup for no new coverage.
import { createEvent } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, freshEmail, login } from './fixtures';
import { connectTestBandDoc, signInForToken, signUpForToken } from './hocuspocusTestClient';

const SERVER_URL = process.env.VITE_DEFAULT_SERVER_URL ?? 'http://localhost:3001';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

test('a nickname set in Band Settings replaces the real name there and in the availability list, for the viewer only', async ({
  browser,
}) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'member-nicknames');
  const bobEmail = freshEmail('nickname-bob');
  const bob = await signUpForToken('Real Name Bob', bobEmail, DEMO_PASSWORD);

  const inviteRes = await fetch(`${SERVER_URL}/bands/${bandId}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ label: 'test-bob', role: 'member' }),
  });
  const { code } = (await inviteRes.json()) as { code: string };
  await fetch(`${SERVER_URL}/invites/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bob.token}` },
    body: JSON.stringify({ code }),
  });

  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();
  const eventId = createEvent(setup.doc, {
    type: 'rehearsal',
    title: 'Nickname Test Rehearsal',
    startsAt: Date.now() + 1000 * 60 * 60 * 24 * 5,
    allDay: false,
    status: 'confirmed',
  });
  await flush();

  const ownerContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const bobPage = await bobContext.newPage();

  try {
    await login(ownerPage, DEMO_OWNER_EMAIL);
    await login(bobPage, bobEmail);

    await ownerPage.goto(`/bands/${bandId}/settings`);
    await expect(ownerPage.getByText('Real Name Bob', { exact: true })).toBeVisible();

    const bobRow = ownerPage.locator('tr', { hasText: 'Real Name Bob' });
    await bobRow.getByRole('button', { name: 'Set nickname for Real Name Bob' }).click();
    await bobRow.getByPlaceholder('Nickname').fill('Bobby');
    await bobRow.getByRole('button', { name: 'Save' }).click();

    // The member list now shows the nickname instead of the real name, with
    // the real name kept visible alongside it so an admin doesn't lose
    // track of who they're actually managing roles/removal for.
    await expect(ownerPage.getByText('Bobby', { exact: true })).toBeVisible();
    await expect(ownerPage.getByText('Real name: Real Name Bob')).toBeVisible();

    // The same nickname replaces the name in the event's availability list.
    await ownerPage.goto(`/bands/${bandId}/calendar/${eventId}`);
    await expect(ownerPage.getByRole('listitem').filter({ hasText: 'Bobby' })).toBeVisible();

    // Bob's own view of himself is entirely unaffected — the nickname is
    // private to whoever set it, not a shared rename.
    await bobPage.goto(`/bands/${bandId}/calendar/${eventId}`);
    await expect(bobPage.getByRole('listitem').filter({ hasText: 'Real Name Bob' })).toBeVisible();
    await expect(bobPage.getByText('Bobby')).toHaveCount(0);
  } finally {
    await ownerContext.close();
    await bobContext.close();
    await deleteThrowawayBand(ownerToken, bandId);
    setup.provider.destroy();
  }
});
