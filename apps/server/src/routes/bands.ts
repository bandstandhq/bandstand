// SPDX-License-Identifier: AGPL-3.0-or-later
import { can, createBandInputSchema, generateInviteCode, permanentDeletionAt, renameBandInputSchema, slugify } from '@bandstand/core';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
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
    // Archived (pending permanent deletion — see the DELETE route below)
    // bands are excluded, same as if they were already gone; `GET
    // /bands/archived` is the separate, owner-only view that surfaces them
    // again for a restore.
    .where(and(eq(bandMembers.userId, userId), isNull(bands.archivedAt)))
    // Deterministic order matters here — the web client defaults to the
    // first result as the active band (BandSwitcher.tsx) when none is
    // already selected, and a plain unordered SELECT's row order isn't
    // guaranteed by Postgres to stay stable across query plans/versions.
    .orderBy(bandMembers.joinedAt);
  return c.json(rows);
});

// Owner-only, across every band this user owns — a "recently deleted"
// view so an owner can find and restore a band they archived, without it
// cluttering the normal band list/switcher.
bandsRoute.get('/archived', async (c) => {
  const userId = c.get('userId');
  const rows = await db
    .select({ id: bands.id, name: bands.name, slug: bands.slug, archivedAt: bands.archivedAt })
    .from(bandMembers)
    .innerJoin(bands, eq(bandMembers.bandId, bands.id))
    .where(and(eq(bandMembers.userId, userId), eq(bandMembers.role, 'owner'), isNotNull(bands.archivedAt)));
  return c.json(
    rows.map((row) => ({
      ...row,
      permanentDeletionAt: new Date(permanentDeletionAt(row.archivedAt!.getTime())).toISOString(),
    })),
  );
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
//
// A real, production band is archived rather than deleted outright — the
// owner has 30 days to restore it (POST /restore below) before
// sweepArchived.ts's cron job permanently removes it. Test fixtures (the
// "test-" slug prefix — see CONTRIBUTING.md) and anything created against a
// non-production server skip the grace period and delete immediately,
// exactly as before: the undo window protects a real band's real data, not
// cleanup scripts or local development.
bandScoped.delete('/', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  if (!bandId) return c.json({ error: 'Missing bandId' }, 400);
  if (!can(c.get('bandRole'), 'band:delete')) return c.json({ error: 'Forbidden' }, 403);

  const [existing] = await db.select({ slug: bands.slug }).from(bands).where(eq(bands.id, bandId));
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const deleteImmediately = existing.slug.startsWith('test-') || process.env.NODE_ENV !== 'production';
  if (deleteImmediately) {
    await db.delete(bands).where(eq(bands.id, bandId));
    hocuspocusServer.hocuspocus.closeConnections(bandId);
    return c.json({ ok: true, archived: false });
  }

  const [band] = await db.update(bands).set({ archivedAt: new Date() }).where(eq(bands.id, bandId)).returning();
  if (!band) return c.json({ error: 'Not found' }, 404);
  hocuspocusServer.hocuspocus.closeConnections(bandId);
  return c.json({
    ok: true,
    archived: true,
    permanentDeletionAt: new Date(permanentDeletionAt(band.archivedAt!.getTime())).toISOString(),
  });
});

bandScoped.post('/restore', requireBandRole('owner'), async (c) => {
  const bandId = c.req.param('bandId');
  if (!bandId) return c.json({ error: 'Missing bandId' }, 400);

  const [existing] = await db.select({ archivedAt: bands.archivedAt }).from(bands).where(eq(bands.id, bandId));
  if (!existing) return c.json({ error: 'Not found' }, 404);
  if (!existing.archivedAt) return c.json({ error: 'Band is not archived' }, 400);

  const [band] = await db.update(bands).set({ archivedAt: null }).where(eq(bands.id, bandId)).returning();
  return c.json(band);
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
