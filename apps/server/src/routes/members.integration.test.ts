// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Real Postgres, hit through the actual, fully composed app (../app.ts) —
// proving the role checks and the one-owner invariant hold against real
// data. See docs/adr/0005-permissions.md.
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../app';
import { db } from '../db/client';
import { bandMembers, bands, users } from '../db/schema/index';
import { auth } from '../lib/auth';

async function signUpTestUser(name = 'Members Tester') {
  const email = `test-members-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return { userId: result.user.id, token: result.token };
}

function req(path: string, method: string, token: string, body?: unknown) {
  return app.request(`/bands${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

// Registers every user/band it creates for cleanup itself — a caller that
// only destructures the fields it needs (e.g. `{ band, admin, member }`)
// used to also have to remember to separately push every id it got back
// into cleanupUserIds/cleanupBandIds, and several call sites here forgot
// `owner` (see issue for the accumulated leak this caused). Taking the
// arrays as parameters and pushing internally makes that impossible to
// forget again.
async function setupBand(cleanupUserIds: string[], cleanupBandIds: string[]) {
  const owner = await signUpTestUser();
  const admin = await signUpTestUser();
  const member = await signUpTestUser();

  const [band] = await db
    .insert(bands)
    .values({ name: 'Members Test Band', slug: `test-members-test-${randomUUID()}` })
    .returning();
  if (!band) throw new Error('Setup insert returned no row');
  cleanupUserIds.push(owner.userId, admin.userId, member.userId);
  cleanupBandIds.push(band.id);

  await db.insert(bandMembers).values([
    { bandId: band.id, userId: owner.userId, role: 'owner', instruments: [] },
    { bandId: band.id, userId: admin.userId, role: 'admin', instruments: [] },
    { bandId: band.id, userId: member.userId, role: 'member', instruments: [] },
  ]);

  return { band, owner, admin, member };
}

async function roleOf(bandId: string, userId: string) {
  const [row] = await db
    .select({ role: bandMembers.role })
    .from(bandMembers)
    .where(and(eq(bandMembers.bandId, bandId), eq(bandMembers.userId, userId)));
  return row?.role;
}

describe('band member management (integration)', () => {
  const cleanupUserIds: string[] = [];
  const cleanupBandIds: string[] = [];

  afterAll(async () => {
    for (const bandId of cleanupBandIds) await db.delete(bands).where(eq(bands.id, bandId));
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  it('rejects a member changing a role, but lets the owner', async () => {
    const { band, owner, admin, member } = await setupBand(cleanupUserIds, cleanupBandIds);

    const forbidden = await req(`/${band.id}/members/${admin.userId}/role`, 'PATCH', member.token, { role: 'member' });
    expect(forbidden.status).toBe(403);

    const ok = await req(`/${band.id}/members/${admin.userId}/role`, 'PATCH', owner.token, { role: 'member' });
    expect(ok.status).toBe(200);
    expect(await roleOf(band.id, admin.userId)).toBe('member');
  });

  it('rejects an admin changing a role — owner only', async () => {
    const { band, admin, member } = await setupBand(cleanupUserIds, cleanupBandIds);

    const res = await req(`/${band.id}/members/${member.userId}/role`, 'PATCH', admin.token, { role: 'admin' });
    expect(res.status).toBe(403);
  });

  it('lets an admin remove a plain member, but not another admin or the owner', async () => {
    const { band, owner, admin, member } = await setupBand(cleanupUserIds, cleanupBandIds);
    const secondAdmin = await signUpTestUser();
    cleanupUserIds.push(secondAdmin.userId);
    await db.insert(bandMembers).values({ bandId: band.id, userId: secondAdmin.userId, role: 'admin', instruments: [] });

    const removeMember = await req(`/${band.id}/members/${member.userId}`, 'DELETE', admin.token);
    expect(removeMember.status).toBe(200);
    expect(await roleOf(band.id, member.userId)).toBeUndefined();

    const removeOtherAdmin = await req(`/${band.id}/members/${secondAdmin.userId}`, 'DELETE', admin.token);
    expect(removeOtherAdmin.status).toBe(403);

    const removeOwner = await req(`/${band.id}/members/${owner.userId}`, 'DELETE', admin.token);
    expect(removeOwner.status).toBe(403);
  });

  it('rejects a plain member removing anyone', async () => {
    const { band, admin, member } = await setupBand(cleanupUserIds, cleanupBandIds);

    const res = await req(`/${band.id}/members/${admin.userId}`, 'DELETE', member.token);
    expect(res.status).toBe(403);
  });

  it('lets the owner remove an admin', async () => {
    const { band, owner, admin } = await setupBand(cleanupUserIds, cleanupBandIds);

    const res = await req(`/${band.id}/members/${admin.userId}`, 'DELETE', owner.token);
    expect(res.status).toBe(200);
    expect(await roleOf(band.id, admin.userId)).toBeUndefined();
  });

  it('transfers ownership: only the owner may, and it flips both roles atomically', async () => {
    const { band, owner, admin } = await setupBand(cleanupUserIds, cleanupBandIds);

    const forbidden = await req(`/${band.id}/members/${admin.userId}/transfer-ownership`, 'POST', admin.token);
    expect(forbidden.status).toBe(403);

    const ok = await req(`/${band.id}/members/${admin.userId}/transfer-ownership`, 'POST', owner.token);
    expect(ok.status).toBe(200);
    expect(await roleOf(band.id, admin.userId)).toBe('owner');
    expect(await roleOf(band.id, owner.userId)).toBe('admin');

    // Exactly one owner, still — the partial unique index would have
    // thrown at the DB level if this transaction had produced two.
    const owners = await db
      .select()
      .from(bandMembers)
      .where(and(eq(bandMembers.bandId, band.id), eq(bandMembers.role, 'owner')));
    expect(owners).toHaveLength(1);
  });

  it('rejects the owner leaving without transferring ownership first, but lets a member or admin leave', async () => {
    const { band, owner, admin, member } = await setupBand(cleanupUserIds, cleanupBandIds);

    const ownerLeave = await req(`/${band.id}/members/me`, 'DELETE', owner.token);
    expect(ownerLeave.status).toBe(409);
    expect(await roleOf(band.id, owner.userId)).toBe('owner');

    const memberLeave = await req(`/${band.id}/members/me`, 'DELETE', member.token);
    expect(memberLeave.status).toBe(200);
    expect(await roleOf(band.id, member.userId)).toBeUndefined();

    const adminLeave = await req(`/${band.id}/members/me`, 'DELETE', admin.token);
    expect(adminLeave.status).toBe(200);
  });

  it('lists members ordered by role (owner, admin, member) then alphabetically by name — not insertion order', async () => {
    const owner = await signUpTestUser('Zed Owner');
    const adminA = await signUpTestUser('Bob Admin');
    const adminB = await signUpTestUser('Alice Admin');
    const memberA = await signUpTestUser('Yara Member');
    const memberB = await signUpTestUser('Xavier Member');
    cleanupUserIds.push(owner.userId, adminA.userId, adminB.userId, memberA.userId, memberB.userId);

    const [band] = await db
      .insert(bands)
      .values({ name: 'Members Order Test Band', slug: `test-members-order-${randomUUID()}` })
      .returning();
    if (!band) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(band.id);

    // Inserted deliberately out of both role and alphabetical order.
    await db.insert(bandMembers).values([
      { bandId: band.id, userId: memberA.userId, role: 'member', instruments: [] },
      { bandId: band.id, userId: adminA.userId, role: 'admin', instruments: [] },
      { bandId: band.id, userId: memberB.userId, role: 'member', instruments: [] },
      { bandId: band.id, userId: owner.userId, role: 'owner', instruments: [] },
      { bandId: band.id, userId: adminB.userId, role: 'admin', instruments: [] },
    ]);

    const res = await req(`/${band.id}/members`, 'GET', owner.token);
    expect(res.status).toBe(200);
    const names = (await res.json()) as Array<{ name: string }>;
    expect(names.map((m) => m.name)).toEqual(['Zed Owner', 'Alice Admin', 'Bob Admin', 'Xavier Member', 'Yara Member']);
  });

  it('lets a member update their own instruments', async () => {
    const { band, member } = await setupBand(cleanupUserIds, cleanupBandIds);

    const res = await req(`/${band.id}/members/me`, 'PATCH', member.token, { instruments: ['Bass', 'Vocals'] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ instruments: ['Bass', 'Vocals'] });

    const [row] = await db
      .select({ instruments: bandMembers.instruments })
      .from(bandMembers)
      .where(and(eq(bandMembers.bandId, band.id), eq(bandMembers.userId, member.userId)));
    expect(row?.instruments).toEqual(['Bass', 'Vocals']);
  });
});
