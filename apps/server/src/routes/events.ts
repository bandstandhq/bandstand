// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Deleting an event (or dissolving a whole series) mutates the shared band
// Yjs document, so it goes through withBandDoc rather than a client's own
// CRDT write — see docs/adr/0005-permissions.md and
// docs/adr/0011-calendar-events.md. Ordinary event creation/editing is
// admin-gated but stays pure CRDT, same as setlists, so deletion is the only
// event route here.
import { can, deleteEvent, deleteEventSeries } from '@bandstand/core';
import { Hono } from 'hono';
import type { BandVariables } from '../lib/bandAuthz';
import { requireBandRole } from '../lib/bandAuthz';
import { withBandDoc } from '../lib/bandDoc';

export const eventsRoute = new Hono<{ Variables: BandVariables }>();

/**
 * `?scope=series` dissolves the whole series (template + every exception +
 * every answer); the default deletes just this one entry. "Cancel a single
 * date" is a different user action still — that's an ordinary CRDT write
 * (`cancelOccurrence`), since it adds an exception rather than removing
 * anything.
 */
eventsRoute.delete('/:eventId', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  const eventId = c.req.param('eventId');
  if (!bandId || !eventId) return c.json({ error: 'Missing params' }, 400);
  if (!can(c.get('bandRole'), 'event:delete')) return c.json({ error: 'Forbidden' }, 403);

  const scope = c.req.query('scope');
  if (scope !== undefined && scope !== 'series') return c.json({ error: 'Invalid scope' }, 400);

  await withBandDoc(bandId, (doc) => {
    if (scope === 'series') deleteEventSeries(doc, eventId);
    else deleteEvent(doc, eventId);
  });

  return c.json({ ok: true });
});
