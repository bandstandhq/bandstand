// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Needs a real Postgres — a code's atomic redemption race can't be faked
// with mocks (see db/schema/invites.ts's comment on the conditional UPDATE).
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { bandMembers, bands, invites, users } from '../db/schema/index';
import { auth } from '../lib/auth';
import { inviteRedemptionRoute } from './invites';

async function signUpTestUser() {
  const email = `invite-race-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'Race Tester' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return { userId: result.user.id, token: result.token };
}

function redeem(code: string, token: string) {
  return inviteRedemptionRoute.request('/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code }),
  });
}

describe('POST /invites/redeem (integration)', () => {
  const cleanupUserIds: string[] = [];
  const cleanupBandIds: string[] = [];

  afterAll(async () => {
    for (const bandId of cleanupBandIds) await db.delete(bands).where(eq(bands.id, bandId));
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  it('lets exactly one of two concurrent redemptions of the same code succeed', async () => {
    const creator = await signUpTestUser();
    const redeemerA = await signUpTestUser();
    const redeemerB = await signUpTestUser();
    cleanupUserIds.push(creator.userId, redeemerA.userId, redeemerB.userId);

    const [band] = await db
      .insert(bands)
      .values({ name: 'Invite Race Band', slug: `invite-race-band-${randomUUID()}` })
      .returning();
    if (!band) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(band.id);

    await db
      .insert(bandMembers)
      .values({ bandId: band.id, userId: creator.userId, role: 'owner', instruments: [] });

    const [invite] = await db
      .insert(invites)
      .values({
        bandId: band.id,
        code: 'AB3D9Z',
        label: 'Race Tester',
        role: 'member',
        createdBy: creator.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning();
    if (!invite) throw new Error('Setup insert returned no row');

    const [resA, resB] = await Promise.all([
      redeem(invite.code, redeemerA.token),
      redeem(invite.code, redeemerB.token),
    ]);

    expect([resA.status, resB.status].sort()).toEqual([200, 404]);

    const members = await db.select().from(bandMembers).where(eq(bandMembers.bandId, band.id));
    // The creator (owner) plus exactly one successful redeemer.
    expect(members).toHaveLength(2);

    const [reloadedInvite] = await db.select().from(invites).where(eq(invites.id, invite.id));
    expect(reloadedInvite?.redeemedAt).not.toBeNull();
  });

  it('rejects redeeming an already-fully-consumed code a third time', async () => {
    const creator = await signUpTestUser();
    const redeemerA = await signUpTestUser();
    const redeemerB = await signUpTestUser();
    cleanupUserIds.push(creator.userId, redeemerA.userId, redeemerB.userId);

    const [band] = await db
      .insert(bands)
      .values({ name: 'Invite Race Band 2', slug: `invite-race-band-${randomUUID()}` })
      .returning();
    if (!band) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(band.id);

    const [invite] = await db
      .insert(invites)
      .values({
        bandId: band.id,
        code: 'AB3D9Y',
        label: 'Race Tester',
        role: 'member',
        createdBy: creator.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning();
    if (!invite) throw new Error('Setup insert returned no row');

    const first = await redeem(invite.code, redeemerA.token);
    expect(first.status).toBe(200);

    const second = await redeem(invite.code, redeemerB.token);
    expect(second.status).toBe(404);
  });
});
