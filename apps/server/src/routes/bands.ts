// SPDX-License-Identifier: AGPL-3.0-or-later
import { can, createBandInputSchema, generateInviteCode, renameBandInputSchema, slugify } from '@bandstand/core';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { bandMembers, bands } from '../db/schema/index';
import type { AuthVariables, BandVariables } from '../lib/bandAuthz';
import { requireAuth, requireBandRole } from '../lib/bandAuthz';
import { hocuspocusServer } from '../lib/hocuspocus';
import { isUniqueViolation } from '../lib/pgErrors';
import { annotationsRoute } from './annotations';
import { eventsRoute } from './events';
import { filesRoute } from './files';
import { inviteManagementRoute } from './invites';
import { membersRoute } from './members';
import { nicknamesRoute } from './nicknames';
import { pollsRoute } from './polls';
import { setlistsRoute } from './setlists';
import { songsRoute } from './songs';

export const bandsRoute = new Hono<{ Variables: AuthVariables }>();

bandsRoute.use('*', requireAuth);

bandsRoute.post('/', async (c) => {
  const body = createBandInputSchema.parse(await c.req.json());
  const userId = c.get('userId');
  const baseSlug = slugify(body.name) || 'band';

  // Slugs are unique; on a collision, retry with a short random suffix
  // rather than asking the user to pick a different name.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${generateInviteCode().slice(0, 4).toLowerCase()}`;
    try {
      const [band] = await db.insert(bands).values({ name: body.name, slug }).returning();
      if (!band) throw new Error('Insert returned no row');
      await db
        .insert(bandMembers)
        .values({ bandId: band.id, userId, role: 'owner', instruments: [] });
      return c.json(band, 201);
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  return c.json({ error: 'Could not generate a unique band slug' }, 500);
});

bandsRoute.get('/', async (c) => {
  const userId = c.get('userId');
  const rows = await db
    .select({ id: bands.id, name: bands.name, slug: bands.slug, role: bandMembers.role })
    .from(bandMembers)
    .innerJoin(bands, eq(bandMembers.bandId, bands.id))
    .where(eq(bandMembers.userId, userId))
    // Deterministic order matters here — the web client defaults to the
    // first result as the active band (BandSwitcher.tsx) when none is
    // already selected, and a plain unordered SELECT's row order isn't
    // guaranteed by Postgres to stay stable across query plans/versions.
    .orderBy(bandMembers.joinedAt);
  return c.json(rows);
});

const bandScoped = new Hono<{ Variables: BandVariables }>();

bandScoped.patch('/', requireBandRole('admin'), async (c) => {
  const body = renameBandInputSchema.parse(await c.req.json());
  const bandId = c.req.param('bandId');
  if (!bandId) return c.json({ error: 'Missing bandId' }, 400);
  const [band] = await db
    .update(bands)
    .set({ name: body.name })
    .where(eq(bands.id, bandId))
    .returning();
  if (!band) return c.json({ error: 'Not found' }, 404);
  return c.json(band);
});

// No Yjs-doc bypass vector here — band membership/invites live only in
// Postgres, which a client can only ever reach through this same REST API
// (see docs/adr/0005-permissions.md). Plain role-check is the whole story.
bandScoped.delete('/', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  if (!bandId) return c.json({ error: 'Missing bandId' }, 400);
  if (!can(c.get('bandRole'), 'band:delete')) return c.json({ error: 'Forbidden' }, 403);

  const [band] = await db.delete(bands).where(eq(bands.id, bandId)).returning();
  if (!band) return c.json({ error: 'Not found' }, 404);

  hocuspocusServer.hocuspocus.closeConnections(bandId);
  return c.json({ ok: true });
});

bandScoped.route('/members', membersRoute);
bandScoped.route('/nicknames', nicknamesRoute);
bandScoped.route('/invites', inviteManagementRoute);
bandScoped.route('/songs', songsRoute);
bandScoped.route('/setlists', setlistsRoute);
bandScoped.route('/files', filesRoute);
bandScoped.route('/annotations', annotationsRoute);
bandScoped.route('/events', eventsRoute);
bandScoped.route('/polls', pollsRoute);

bandsRoute.route('/:bandId', bandScoped);
