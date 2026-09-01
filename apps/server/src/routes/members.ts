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
import { findOwnershipSuccessor } from '../lib/ownershipSuccession';

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

// Owner-only preview of who `DELETE /me` would hand ownership to — so the
// web UI can name the successor in its confirmation dialog *before* the
// owner commits to leaving, per the brief ("informed who takes over before
// they confirm"). Re-run at commit time by the DELETE handler itself
// rather than trusted from a prior call — the membership list can change
// between the two requests.
membersRoute.get('/successor', requireBandRole('owner'), async (c) => {
  const bandId = c.req.param('bandId');
  const userId = c.get('userId');
  if (!bandId) return c.json({ error: 'Missing bandId' }, 400);
  return c.json({ successor: await findOwnershipSuccessor(bandId, userId) });
});

membersRoute.delete('/me', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  const userId = c.get('userId');
  if (!bandId) return c.json({ error: 'Missing bandId' }, 400);
  const role = c.get('bandRole');

  // can(role, 'band:leave') is unconditionally true for every role — the
  // owner case below is band *state*, not a role check, so it's handled
  // here rather than expressed as a matrix cell. Ownership transfers
  // automatically to the highest-ranked remaining member (ties broken by
  // seniority — see ownershipSuccession.ts) rather than blocking the
  // owner from leaving at all; only a sole remaining owner (no one else
  // left to hand it to) is still rejected.
  if (role === 'owner') {
    const successor = await findOwnershipSuccessor(bandId, userId);
    if (!successor) {
      return c.json({ error: 'owner_must_transfer_first' }, 409);
    }
    // Order matters: band_members_one_owner_idx is a plain (non-deferred)
    // unique index, checked per-statement — the leaving owner's row must be
    // gone *before* the successor's role flips to 'owner', or both
    // statements would momentarily describe two owners at once and the
    // second UPDATE would violate the constraint (transfer-ownership's own
    // two updates avoid this the same way, by demoting the old owner
    // first).
    await db.transaction(async (tx) => {
      await tx.delete(bandMembers).where(and(eq(bandMembers.bandId, bandId), eq(bandMembers.userId, userId)));
      await tx
        .update(bandMembers)
        .set({ role: 'owner' })
        .where(and(eq(bandMembers.bandId, bandId), eq(bandMembers.userId, successor.userId)));
    });
    return c.json({ ok: true, newOwner: { userId: successor.userId, name: successor.name } });
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
