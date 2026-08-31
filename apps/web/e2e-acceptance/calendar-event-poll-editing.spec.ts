// SPDX-License-Identifier: Apache-2.0
//
// Events and polls used to be create-only — the only way to change one
// after the fact was cancelling/deleting it. An owner/admin can now edit
// both, including adding a new date proposal to a poll that's already
// collecting votes, without touching the votes already cast. See
// docs/adr/0011-calendar-events.md for the underlying data model.
import { createEvent, createPoll, listPolls, votePoll } from '@bandstand/core';
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

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

test('an owner can edit an event, and the change is reflected immediately', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'event-editing');
  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();

  const eventId = createEvent(setup.doc, {
    type: 'rehearsal',
    title: 'Original Title',
    startsAt: Date.now() + 24 * 60 * 60 * 1000,
    allDay: false,
    status: 'confirmed',
  });
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/calendar/${eventId}`);

    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit event' })).toBeVisible();
    await page.getByPlaceholder('Event title').fill('Updated Title');
    await page.getByPlaceholder('Location').fill('New Rehearsal Room');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByRole('heading', { name: 'Edit event' })).not.toBeVisible();
    await expect(page.getByRole('heading', { name: /Updated Title/ })).toBeVisible();
    await expect(page.getByText('New Rehearsal Room')).toBeVisible();
  } finally {
    setup.provider.destroy();
    await deleteThrowawayBand(ownerToken, bandId);
  }
});

test('editing a poll to add proposals preserves existing votes, and rank badges appear once there are enough options', async ({
  page,
}) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'poll-editing');
  await withDb(async (client) => {
    const bobUserId = await getUserIdByEmail(client, DEMO_MEMBER_EMAIL);
    await addBandMember(client, bandId, bobUserId);
  });
  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();
  // A second, real connection as bob — votes are ownership-guarded
  // server-side (a write's trailing `:<userId>` must match the actor's own
  // id), so casting a second, distinct "yes" on option A needs an actual
  // second member, not a second call from the owner's own connection.
  const bobToken = await signInForToken(DEMO_MEMBER_EMAIL, DEMO_PASSWORD);
  const bobSetup = connectTestBandDoc(bandId, bobToken);
  await bobSetup.waitForSynced();
  const [ownerUserId, bobUserId] = await withDb(async (client) => [
    await getUserIdByEmail(client, DEMO_OWNER_EMAIL),
    await getUserIdByEmail(client, DEMO_MEMBER_EMAIL),
  ]);

  const now = Date.now();
  const pollId = createPoll(setup.doc, {
    title: 'Original Poll',
    options: [{ startsAt: now + 5 * 24 * 60 * 60 * 1000 }, { startsAt: now + 6 * 24 * 60 * 60 * 1000 }],
  });
  const [optionA, optionB] = listPolls(setup.doc)[pollId]!.options;
  // Both already have votes — option A the clear favorite (2 yes, from two
  // different real members), option B a distant second (1 yes). With only
  // two options, "2nd place" is meaningless, so neither should show a rank
  // badge yet.
  votePoll(setup.doc, pollId, optionA!.id, ownerUserId, 'yes');
  votePoll(bobSetup.doc, pollId, optionA!.id, bobUserId, 'yes');
  votePoll(setup.doc, pollId, optionB!.id, ownerUserId, 'yes');
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/polls/${pollId}`);
    await expect(page.getByText('2 yes, 0 maybe, 0 no')).toBeVisible();
    // With only two options, the best one alone is shown — a "2nd place"
    // badge on the other one would just mean "not the best", not useful.
    await expect(page.getByText('#1 choice')).toBeVisible();
    await expect(page.getByText('#2 choice')).toHaveCount(0);

    // Edit: rename the poll and add a third proposal — nobody has voted on
    // it, so it gets no badge, but its presence is what makes "2nd place"
    // worth showing for option B.
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit poll' })).toBeVisible();
    await page.getByPlaceholder('Poll title').fill('Renamed Poll');
    await page.locator('input[type="datetime-local"]').fill('2027-03-01T18:00');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByRole('heading', { name: 'Edit poll' })).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Renamed Poll' })).toBeVisible();
    // Existing votes on option A/B survived the edit untouched.
    await expect(page.getByText('2 yes, 0 maybe, 0 no')).toBeVisible();
    await expect(page.getByText('1 yes, 0 maybe, 0 no')).toBeVisible();
    await expect(page.getByText('#1 choice')).toBeVisible();
    await expect(page.getByText('#2 choice')).toBeVisible();
    await expect(page.getByText('#3 choice')).toHaveCount(0);

    // Add a 4th proposal, this time with its own vote — now the 3rd-place
    // badge should appear too, but only once it actually has a vote.
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.locator('input[type="datetime-local"]').fill('2027-03-02T18:00');
    await page.getByRole('button', { name: 'Save changes' }).click();
    const polls = listPolls(setup.doc);
    const newOption = polls[pollId]!.options.find((o) => o.startsAt === Date.parse('2027-03-02T18:00'));
    votePoll(bobSetup.doc, pollId, newOption!.id, bobUserId, 'yes');
    await flush();

    await expect(page.getByText('#3 choice')).toBeVisible();
  } finally {
    setup.provider.destroy();
    bobSetup.provider.destroy();
    await deleteThrowawayBand(ownerToken, bandId);
  }
});
