// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Mounted at /bands/:bandId/nicknames. Strictly self-scoped in both
// directions: every route only ever reads or writes the caller's own
// nicknames for other members — there's no route to read anyone else's, and
// none to set one for yourself. Lives only in Postgres, exactly like
// userPrefs.ts's songNotes, for the same reason: this must never appear in
// the shared, synced band doc.
import { setNicknameInputSchema } from '@bandstand/core';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { memberNicknames } from '../db/schema/index';
import type { BandVariables } from '../lib/bandAuthz';
import { requireBandRole } from '../lib/bandAuthz';

export const nicknamesRoute = new Hono<{ Variables: BandVariables }>();

nicknamesRoute.get('/', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  const viewerUserId = c.get('userId');
  if (!bandId) return c.json({ error: 'Missing bandId' }, 400);

  const rows = await db
    .select({ targetUserId: memberNicknames.targetUserId, nickname: memberNicknames.nickname })
    .from(memberNicknames)
    .where(and(eq(memberNicknames.bandId, bandId), eq(memberNicknames.viewerUserId, viewerUserId)));

  return c.json(Object.fromEntries(rows.map((row) => [row.targetUserId, row.nickname])));
});

nicknamesRoute.put('/:targetUserId', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  const targetUserId = c.req.param('targetUserId');
  const viewerUserId = c.get('userId');
  if (!bandId || !targetUserId) return c.json({ error: 'Missing params' }, 400);
  if (targetUserId === viewerUserId) return c.json({ error: 'Cannot set a nickname for yourself' }, 400);

  const body = setNicknameInputSchema.parse(await c.req.json());
  await db
    .insert(memberNicknames)
    .values({ bandId, viewerUserId, targetUserId, nickname: body.nickname })
    .onConflictDoUpdate({
      target: [memberNicknames.bandId, memberNicknames.viewerUserId, memberNicknames.targetUserId],
      set: { nickname: body.nickname, updatedAt: new Date() },
    });

  return c.json({ targetUserId, nickname: body.nickname });
});

nicknamesRoute.delete('/:targetUserId', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  const targetUserId = c.req.param('targetUserId');
  const viewerUserId = c.get('userId');
  if (!bandId || !targetUserId) return c.json({ error: 'Missing params' }, 400);

  await db
    .delete(memberNicknames)
    .where(
      and(
        eq(memberNicknames.bandId, bandId),
        eq(memberNicknames.viewerUserId, viewerUserId),
        eq(memberNicknames.targetUserId, targetUserId),
      ),
    );

  return c.json({ ok: true });
});
