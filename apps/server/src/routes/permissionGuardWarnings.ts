// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Mounted at /bands/:bandId/permission-guard-warnings. Surfaces the onChange
// guard's reverts (hocuspocus.ts, issue #48) to owner/admin — everyone else
// gets a plain 403 from requireBandRole, same as invites/full-repertoire-export.
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { permissionGuardWarnings, users } from '../db/schema/index';
import type { BandVariables } from '../lib/bandAuthz';
import { requireBandRole } from '../lib/bandAuthz';

export const permissionGuardWarningsRoute = new Hono<{ Variables: BandVariables }>();

permissionGuardWarningsRoute.get('/', requireBandRole('admin'), async (c) => {
  const bandId = c.req.param('bandId');
  if (!bandId) return c.json({ error: 'Missing bandId' }, 400);

  const rows = await db
    .select({
      id: permissionGuardWarnings.id,
      mapName: permissionGuardWarnings.mapName,
      key: permissionGuardWarnings.key,
      createdAt: permissionGuardWarnings.createdAt,
      actingUserName: users.name,
    })
    .from(permissionGuardWarnings)
    .leftJoin(users, eq(permissionGuardWarnings.actingUserId, users.id))
    .where(and(eq(permissionGuardWarnings.bandId, bandId), isNull(permissionGuardWarnings.acknowledgedAt)))
    .orderBy(desc(permissionGuardWarnings.createdAt));

  return c.json(rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })));
});

permissionGuardWarningsRoute.post('/:id/acknowledge', requireBandRole('admin'), async (c) => {
  const bandId = c.req.param('bandId');
  const id = c.req.param('id');
  if (!bandId || !id) return c.json({ error: 'Missing params' }, 400);
  const userId = c.get('userId');

  await db
    .update(permissionGuardWarnings)
    .set({ acknowledgedAt: new Date(), acknowledgedBy: userId })
    .where(and(eq(permissionGuardWarnings.id, id), eq(permissionGuardWarnings.bandId, bandId)));

  return c.json({ ok: true });
});
