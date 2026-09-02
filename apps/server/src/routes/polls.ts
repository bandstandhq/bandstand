// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Deleting a poll, and closing one into a real event, both mutate the shared
// band Yjs document server-side rather than through a client's own CRDT
// write — see docs/adr/0005-permissions.md and
// docs/adr/0011-calendar-events.md. Creating a poll and voting in one stay
// pure CRDT (admin-gated and member-open respectively).
import {
  can,
  closePollInputSchema,
  createEvent,
  deletePoll,
  listPolls,
  listVotesForPoll,
  markPollResolved,
  respondAvailability,
} from '@bandstand/core';
import { Hono } from 'hono';
import type { BandVariables } from '../lib/bandAuthz';
import { requireBandRole } from '../lib/bandAuthz';
import { withBandDoc } from '../lib/bandDoc';

export const pollsRoute = new Hono<{ Variables: BandVariables }>();

pollsRoute.delete('/:pollId', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  const pollId = c.req.param('pollId');
  if (!bandId || !pollId) return c.json({ error: 'Missing params' }, 400);
  if (!can(c.get('bandRole'), 'poll:close')) return c.json({ error: 'Forbidden' }, 403);

  await withBandDoc(bandId, (doc) => deletePoll(doc, pollId));

  return c.json({ ok: true });
});

/**
 * Turns the winning option into a real event and marks the poll resolved —
 * both inside one `withBandDoc` transaction, so the poll can never be left
 * pointing at an event that doesn't exist (or an event created with no poll
 * closed behind it).
 */
pollsRoute.post('/:pollId/close', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  const pollId = c.req.param('pollId');
  if (!bandId || !pollId) return c.json({ error: 'Missing params' }, 400);
  if (!can(c.get('bandRole'), 'poll:close')) return c.json({ error: 'Forbidden' }, 403);

  const body = closePollInputSchema.parse(await c.req.json());

  const result = await withBandDoc(bandId, (doc) => {
    const poll = listPolls(doc)[pollId];
    if (!poll) return { error: 'not-found' as const };
    if (poll.resolvedEventId) return { error: 'already-closed' as const };

    const option = poll.options.find((o) => o.id === body.optionId);
    if (!option) return { error: 'unknown-option' as const };

    const eventId = createEvent(doc, {
      type: body.type,
      title: body.title,
      startsAt: option.startsAt,
      endsAt: option.endsAt,
      allDay: false,
      location: body.location,
      notes: body.notes,
      status: 'confirmed',
    });
    markPollResolved(doc, pollId, eventId);

    // Whoever already answered for the winning option shouldn't have to
    // answer again for the event it becomes — same AvailabilityAnswer type
    // on both sides, no mapping needed. Only the winning option's votes
    // carry over; a "no" on some other, losing option says nothing about
    // this event.
    const votes = listVotesForPoll(doc, pollId);
    const winningOptionPrefix = `${body.optionId}:`;
    for (const [key, answer] of Object.entries(votes)) {
      if (!key.startsWith(winningOptionPrefix)) continue;
      const userId = key.slice(winningOptionPrefix.length);
      respondAvailability(doc, eventId, userId, answer);
    }

    return { eventId };
  });

  if ('error' in result) {
    if (result.error === 'not-found') return c.json({ error: 'Poll not found' }, 404);
    if (result.error === 'already-closed') return c.json({ error: 'Poll is already closed' }, 409);
    return c.json({ error: 'Unknown option for this poll' }, 400);
  }

  return c.json({ ok: true, eventId: result.eventId });
});
