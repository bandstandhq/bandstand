// SPDX-License-Identifier: Apache-2.0
//
// The dashboard now surfaces open (not yet closed into an event) polls the
// current user hasn't voted in yet — a member shouldn't have to remember to
// check the calendar/polls list to notice something is waiting on them.
import { createPoll, markPollResolved, type Poll, votePoll } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';
import { getUserIdByEmail, withDb } from './testDb';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

test('an open poll the user hasn\'t voted in shows on the dashboard, and drops off once they vote', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const userId = await withDb((client) => getUserIdByEmail(client, DEMO_OWNER_EMAIL));
  const { bandId } = await createThrowawayBand(ownerToken, 'dashboard-open-polls');
  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();

  const now = Date.now();
  const pollId = createPoll(setup.doc, {
    title: 'Dashboard Poll Test',
    options: [{ startsAt: now + 24 * 60 * 60 * 1000 }],
  });

  // A second, already-resolved poll — must never show, open or not.
  const resolvedPollId = createPoll(setup.doc, {
    title: 'Already Resolved Poll',
    options: [{ startsAt: now + 48 * 60 * 60 * 1000 }],
  });
  markPollResolved(setup.doc, resolvedPollId, 'fake-event-id');
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/dashboard`);

    await expect(page.getByRole('heading', { name: 'Waiting on your vote' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Dashboard Poll Test' })).toBeVisible();
    await expect(page.getByText('Already Resolved Poll')).toHaveCount(0);

    await page.getByRole('link', { name: 'Open Dashboard Poll Test' }).click();
    await expect(page).toHaveURL(new RegExp(`/polls/${pollId}$`));

    const poll = setup.doc.getMap('polls').get(pollId) as Poll;
    votePoll(setup.doc, pollId, poll.options[0]!.id, userId, 'yes');
    await flush();

    await page.goto(`/bands/${bandId}/dashboard`);
    await expect(page.getByRole('heading', { name: 'Waiting on your vote' })).toHaveCount(0);
  } finally {
    setup.provider.destroy();
    await deleteThrowawayBand(ownerToken, bandId);
  }
});
