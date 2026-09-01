// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Real Postgres, through the actual composed app (../app.ts). A nickname is
// strictly private to whoever set it — never visible to anyone else, not
// even the person it's about — and lives only in Postgres, never the band's
// synced Yjs doc. See apps/server/src/routes/nicknames.ts.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../app';
import { db } from '../db/client';
import { bandMembers, bands, users } from '../db/schema/index';
import { auth } from '../lib/auth';

async function signUpTestUser() {
  const email = `test-nicknames-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'Nicknames Tester' },
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

describe('member nicknames (integration)', () => {
  const cleanupUserIds: string[] = [];
  const cleanupBandIds: string[] = [];

  afterAll(async () => {
    for (const bandId of cleanupBandIds) await db.delete(bands).where(eq(bands.id, bandId));
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  async function setupBand() {
    const owner = await signUpTestUser();
    const member = await signUpTestUser();
    const [band] = await db
      .insert(bands)
      .values({ name: 'Nicknames Test Band', slug: `test-nicknames-test-${randomUUID()}` })
      .returning();
    if (!band) throw new Error('Setup insert returned no row');
    cleanupUserIds.push(owner.userId, member.userId);
    cleanupBandIds.push(band.id);
    await db.insert(bandMembers).values([
      { bandId: band.id, userId: owner.userId, role: 'owner', instruments: [] },
      { bandId: band.id, userId: member.userId, role: 'member', instruments: [] },
    ]);
    return { band, owner, member };
  }

  it('sets, lists, and clears a nickname — visible only to whoever set it', async () => {
    const { band, owner, member } = await setupBand();

    const set = await req(`/${band.id}/nicknames/${member.userId}`, 'PUT', owner.token, { nickname: 'Big Bob' });
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ targetUserId: member.userId, nickname: 'Big Bob' });

    const ownerList = await req(`/${band.id}/nicknames`, 'GET', owner.token);
    expect(await ownerList.json()).toEqual({ [member.userId]: 'Big Bob' });

    // The nicknamed member's own view has no nicknames of their own set —
    // someone else's nickname for them is invisible to them.
    const memberList = await req(`/${band.id}/nicknames`, 'GET', member.token);
    expect(await memberList.json()).toEqual({});

    const cleared = await req(`/${band.id}/nicknames/${member.userId}`, 'DELETE', owner.token);
    expect(cleared.status).toBe(200);
    const afterClear = await req(`/${band.id}/nicknames`, 'GET', owner.token);
    expect(await afterClear.json()).toEqual({});
  });

  it('overwrites an existing nickname for the same target rather than erroring', async () => {
    const { band, owner, member } = await setupBand();

    await req(`/${band.id}/nicknames/${member.userId}`, 'PUT', owner.token, { nickname: 'First' });
    const second = await req(`/${band.id}/nicknames/${member.userId}`, 'PUT', owner.token, { nickname: 'Second' });
    expect(second.status).toBe(200);

    const list = await req(`/${band.id}/nicknames`, 'GET', owner.token);
    expect(await list.json()).toEqual({ [member.userId]: 'Second' });
  });

  it('rejects setting a nickname for yourself', async () => {
    const { band, owner } = await setupBand();
    const res = await req(`/${band.id}/nicknames/${owner.userId}`, 'PUT', owner.token, { nickname: 'Me' });
    expect(res.status).toBe(400);
  });

  it('rejects an empty nickname', async () => {
    const { band, owner, member } = await setupBand();
    const res = await req(`/${band.id}/nicknames/${member.userId}`, 'PUT', owner.token, { nickname: '' });
    expect(res.status).toBe(400);
  });

  it('rejects a non-member from reading or setting nicknames in a band', async () => {
    const { band, member } = await setupBand();
    const outsider = await signUpTestUser();
    cleanupUserIds.push(outsider.userId);

    const list = await req(`/${band.id}/nicknames`, 'GET', outsider.token);
    expect(list.status).toBe(403);

    const set = await req(`/${band.id}/nicknames/${member.userId}`, 'PUT', outsider.token, { nickname: 'Nope' });
    expect(set.status).toBe(403);
  });
});
