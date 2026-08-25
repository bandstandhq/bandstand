// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Deleting a whole setlist mutates the shared band Yjs document, so it goes
// through withBandDoc rather than a client's own CRDT write — see
// docs/adr/0005-permissions.md. Ordinary setlist creation/editing stays
// pure CRDT (every member may do that), so this is the only setlist route.
import { can, deleteSetlist } from '@bandstand/core';
import { Hono } from 'hono';
import type { BandVariables } from '../lib/bandAuthz';
import { requireBandRole } from '../lib/bandAuthz';
import { withBandDoc } from '../lib/bandDoc';

export const setlistsRoute = new Hono<{ Variables: BandVariables }>();

setlistsRoute.delete('/:setlistId', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  const setlistId = c.req.param('setlistId');
  if (!bandId || !setlistId) return c.json({ error: 'Missing params' }, 400);
  if (!can(c.get('bandRole'), 'setlist:delete')) return c.json({ error: 'Forbidden' }, 403);

  await withBandDoc(bandId, (doc) => deleteSetlist(doc, setlistId));

  return c.json({ ok: true });
});
