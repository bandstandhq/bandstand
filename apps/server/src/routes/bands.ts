// SPDX-License-Identifier: AGPL-3.0-or-later
import { createBandInputSchema, generateInviteCode, renameBandInputSchema, slugify } from '@bandstand/core';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { bandMembers, bands, users } from '../db/schema/index';
import type { AuthVariables, BandVariables } from '../lib/bandAuthz';
import { requireAuth, requireBandRole } from '../lib/bandAuthz';
import { isUniqueViolation } from '../lib/pgErrors';
import { inviteManagementRoute } from './invites';

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
    .where(eq(bandMembers.userId, userId));
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

bandScoped.get('/members', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  if (!bandId) return c.json({ error: 'Missing bandId' }, 400);
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: bandMembers.role,
      instruments: bandMembers.instruments,
    })
    .from(bandMembers)
    .innerJoin(users, eq(bandMembers.userId, users.id))
    .where(eq(bandMembers.bandId, bandId));
  return c.json(rows);
});

bandScoped.route('/invites', inviteManagementRoute);

bandsRoute.route('/:bandId', bandScoped);
