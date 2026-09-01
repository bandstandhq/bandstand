// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Band membership lives only in Postgres — no Yjs-doc bypass vector here
// (see docs/adr/0005-permissions.md), so plain role checks are the whole
// enforcement story. requireBandRole('member') is the baseline every
// band-scoped route uses; the actual authorization decision is the inline
// can()/canRemoveMember() check against the one permissions matrix.
import {
  can,
  canRemoveMember,
  changeMemberRoleInputSchema,
  compareMembersByRoleThenName,
  updateMyInstrumentsInputSchema,
} from '@bandstand/core';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { bandMembers, users } from '../db/schema/index';
import type { BandVariables } from '../lib/bandAuthz';
import { getBandMembership, requireBandRole } from '../lib/bandAuthz';

export const membersRoute = new Hono<{ Variables: BandVariables }>();

membersRoute.get('/', requireBandRole('member'), async (c) => {
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
  // Postgres gives no ordering guarantee without ORDER BY, and every
  // consumer (BandSettings, availability lists, follow-mode) renders
  // whatever order this returns — sort here once so the order is fixed and
  // deterministic everywhere, instead of drifting on unrelated writes.
  rows.sort(compareMembersByRoleThenName);
  return c.json(rows);
});

/** A member's own instruments — the free-text list shown band-wide, e.g. "Guitar", "Vocals". */
membersRoute.patch('/me', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  const userId = c.get('userId');
  if (!bandId) return c.json({ error: 'Missing bandId' }, 400);

  const body = updateMyInstrumentsInputSchema.parse(await c.req.json());
  const [updated] = await db
    .update(bandMembers)
    .set({ instruments: body.instruments })
    .where(and(eq(bandMembers.bandId, bandId), eq(bandMembers.userId, userId)))
    .returning();
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json({ instruments: updated.instruments });
});

membersRoute.delete('/me', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  const userId = c.get('userId');
  if (!bandId) return c.json({ error: 'Missing bandId' }, 400);
  const role = c.get('bandRole');

  // can(role, 'band:leave') is unconditionally true for every role — the
  // owner precondition below is band *state*, not a role check, so it's
  // enforced here rather than expressed as a matrix cell.
  if (role === 'owner') {
    return c.json({ error: 'owner_must_transfer_first' }, 409);
  }

  await db.delete(bandMembers).where(and(eq(bandMembers.bandId, bandId), eq(bandMembers.userId, userId)));
  return c.json({ ok: true });
});

membersRoute.patch('/:userId/role', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  const targetUserId = c.req.param('userId');
  if (!bandId || !targetUserId) return c.json({ error: 'Missing params' }, 400);
  if (!can(c.get('bandRole'), 'member:changeRole')) return c.json({ error: 'Forbidden' }, 403);

  // 'owner' is not an accepted value here at all (see
  // changeMemberRoleInputSchema) — becoming "the" owner only ever happens
  // through transfer-ownership below, which is what keeps the one-owner
  // invariant meaningful.
  const body = changeMemberRoleInputSchema.parse(await c.req.json());
  const [updated] = await db
    .update(bandMembers)
    .set({ role: body.role })
    .where(and(eq(bandMembers.bandId, bandId), eq(bandMembers.userId, targetUserId)))
    .returning();
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json({ userId: targetUserId, role: updated.role });
});

membersRoute.delete('/:userId', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  const targetUserId = c.req.param('userId');
  if (!bandId || !targetUserId) return c.json({ error: 'Missing params' }, 400);

  const target = await getBandMembership(bandId, targetUserId);
  if (!target) return c.json({ error: 'Not found' }, 404);
  if (!canRemoveMember(c.get('bandRole'), target.role)) return c.json({ error: 'Forbidden' }, 403);

  await db.delete(bandMembers).where(and(eq(bandMembers.bandId, bandId), eq(bandMembers.userId, targetUserId)));
  return c.json({ ok: true });
});

membersRoute.post('/:userId/transfer-ownership', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  const targetUserId = c.req.param('userId');
  const callerUserId = c.get('userId');
  if (!bandId || !targetUserId) return c.json({ error: 'Missing params' }, 400);
  if (!can(c.get('bandRole'), 'band:transferOwnership')) return c.json({ error: 'Forbidden' }, 403);
  if (targetUserId === callerUserId) {
    return c.json({ error: 'Cannot transfer ownership to yourself' }, 400);
  }

  const target = await getBandMembership(bandId, targetUserId);
  if (!target) return c.json({ error: 'Not found' }, 404);

  // The band_members_one_owner_idx partial unique index backstops this:
  // whichever order these two updates run in, the band briefly has zero
  // owners between them, never two.
  await db.transaction(async (tx) => {
    await tx
      .update(bandMembers)
      .set({ role: 'admin' })
      .where(and(eq(bandMembers.bandId, bandId), eq(bandMembers.userId, callerUserId)));
    await tx
      .update(bandMembers)
      .set({ role: 'owner' })
      .where(and(eq(bandMembers.bandId, bandId), eq(bandMembers.userId, targetUserId)));
  });

  return c.json({ ok: true });
});
