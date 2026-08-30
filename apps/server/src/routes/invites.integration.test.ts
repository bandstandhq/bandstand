// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Needs a real Postgres — a code's atomic redemption race can't be faked
// with mocks (see db/schema/invites.ts's comment on the conditional UPDATE).
import { randomUUID } from 'node:crypto';
import { generateInviteCode } from '@bandstand/core';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../app';
import { db } from '../db/client';
import { bandMembers, bands, invites, users } from '../db/schema/index';
import { auth } from '../lib/auth';

async function signUpTestUser() {
  const email = `test-invite-race-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'Race Tester' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return { userId: result.user.id, token: result.token };
}

function redeem(code: string, token: string) {
  return app.request('/invites/redeem', {
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
      .values({ name: 'Invite Race Band', slug: `test-invite-race-band-${randomUUID()}` })
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
      .values({ name: 'Invite Race Band 2', slug: `test-invite-race-band-${randomUUID()}` })
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

  it('classifies each redemption failure with a distinct, specific error code', async () => {
    const creator = await signUpTestUser();
    const redeemer = await signUpTestUser();
    cleanupUserIds.push(creator.userId, redeemer.userId);

    const [band] = await db
      .insert(bands)
      .values({ name: 'Invite Classification Band', slug: `test-invite-classify-${randomUUID()}` })
      .returning();
    if (!band) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(band.id);

    const unknown = await redeem(generateInviteCode(), redeemer.token);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'unknown_code' });

    const [revokedInvite] = await db
      .insert(invites)
      .values({
        bandId: band.id,
        code: generateInviteCode(),
        label: 'Revoked',
        role: 'member',
        createdBy: creator.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        revokedAt: new Date(),
      })
      .returning();
    const revoked = await redeem(revokedInvite!.code, redeemer.token);
    expect(revoked.status).toBe(404);
    expect(await revoked.json()).toEqual({ error: 'revoked' });

    const [expiredInvite] = await db
      .insert(invites)
      .values({
        bandId: band.id,
        code: generateInviteCode(),
        label: 'Expired',
        role: 'member',
        createdBy: creator.userId,
        expiresAt: new Date(Date.now() - 1000),
      })
      .returning();
    const expired = await redeem(expiredInvite!.code, redeemer.token);
    expect(expired.status).toBe(404);
    expect(await expired.json()).toEqual({ error: 'expired' });

    const [redeemedInvite] = await db
      .insert(invites)
      .values({
        bandId: band.id,
        code: generateInviteCode(),
        label: 'Already redeemed',
        role: 'member',
        createdBy: creator.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        redeemedBy: creator.userId,
        redeemedAt: new Date(),
      })
      .returning();
    const alreadyRedeemed = await redeem(redeemedInvite!.code, redeemer.token);
    expect(alreadyRedeemed.status).toBe(404);
    expect(await alreadyRedeemed.json()).toEqual({ error: 'redeemed' });
  });

  it("rejects a code from an already-a-member caller without consuming it", async () => {
    const creator = await signUpTestUser();
    cleanupUserIds.push(creator.userId);

    const [band] = await db
      .insert(bands)
      .values({ name: 'Invite Already-Member Band', slug: `test-invite-already-member-${randomUUID()}` })
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
        code: generateInviteCode(),
        label: 'Self-invite',
        role: 'member',
        createdBy: creator.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning();
    if (!invite) throw new Error('Setup insert returned no row');

    const res = await redeem(invite.code, creator.token);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_member' });

    // The code is untouched — still redeemable by someone else.
    const [reloaded] = await db.select().from(invites).where(eq(invites.id, invite.id));
    expect(reloaded?.redeemedAt).toBeNull();
  });

  it('accepts a code with a stray internal space, per normalizeInviteCode', async () => {
    const creator = await signUpTestUser();
    const redeemer = await signUpTestUser();
    cleanupUserIds.push(creator.userId, redeemer.userId);

    const [band] = await db
      .insert(bands)
      .values({ name: 'Invite Whitespace Band', slug: `test-invite-whitespace-${randomUUID()}` })
      .returning();
    if (!band) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(band.id);

    const code = generateInviteCode();
    const [invite] = await db
      .insert(invites)
      .values({
        bandId: band.id,
        code,
        label: 'Spaced out',
        role: 'member',
        createdBy: creator.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning();
    if (!invite) throw new Error('Setup insert returned no row');

    const spacedCode = `${code.slice(0, 3)} ${code.slice(3)}`;
    const res = await redeem(spacedCode, redeemer.token);
    expect(res.status).toBe(200);
  });
});
