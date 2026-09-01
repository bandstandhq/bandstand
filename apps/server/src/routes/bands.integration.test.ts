// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Real Postgres, hit through the actual REST routes. GET /bands' ordering
// matters concretely: apps/web/src/components/BandSwitcher.tsx defaults to
// the first result as the active band when none is already selected, and a
// user can genuinely be in more than one band (see apps/server/src/seed) —
// an unordered SELECT leaves which one "loads first" undefined.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../app';
import { db } from '../db/client';
import { bandMembers, bands, users } from '../db/schema/index';
import { auth } from '../lib/auth';

async function signUpTestUser() {
  const email = `test-bands-order-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'Bands Order Tester' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return { userId: result.user.id, token: result.token };
}

function listMyBands(token: string) {
  return app.request('/bands', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

function req(path: string, method: string, token: string) {
  return app.request(`/bands${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
}

describe('GET /bands (integration)', () => {
  const cleanupUserIds: string[] = [];
  const cleanupBandIds: string[] = [];

  afterAll(async () => {
    for (const bandId of cleanupBandIds) await db.delete(bands).where(eq(bands.id, bandId));
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  it('lists a member of several bands in join order, not database-arbitrary order', async () => {
    const user = await signUpTestUser();
    cleanupUserIds.push(user.userId);

    const [firstBand] = await db
      .insert(bands)
      .values({ name: 'First Joined Band', slug: `test-first-joined-${randomUUID()}` })
      .returning();
    const [secondBand] = await db
      .insert(bands)
      .values({ name: 'Second Joined Band', slug: `test-second-joined-${randomUUID()}` })
      .returning();
    if (!firstBand || !secondBand) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(firstBand.id, secondBand.id);

    // Insert the *second* band's membership row first, with an earlier
    // joinedAt — if GET /bands relied on insertion/physical row order
    // instead of joinedAt, this would surface it.
    await db.insert(bandMembers).values([
      {
        bandId: secondBand.id,
        userId: user.userId,
        role: 'member',
        instruments: [],
        joinedAt: new Date('2020-01-02'),
      },
      {
        bandId: firstBand.id,
        userId: user.userId,
        role: 'member',
        instruments: [],
        joinedAt: new Date('2020-01-01'),
      },
    ]);

    const res = await listMyBands(user.token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; name: string }[];
    const names = body.filter((b) => b.id === firstBand.id || b.id === secondBand.id).map((b) => b.name);
    expect(names).toEqual(['First Joined Band', 'Second Joined Band']);
  });
});

describe('DELETE /bands/:bandId — archive, not immediate deletion, for a real band (integration)', () => {
  const cleanupUserIds: string[] = [];
  const cleanupBandIds: string[] = [];
  const originalNodeEnv = process.env.NODE_ENV;

  afterAll(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    for (const bandId of cleanupBandIds) await db.delete(bands).where(eq(bands.id, bandId));
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  async function setupOwnedBand(slug: string) {
    const owner = await signUpTestUser();
    cleanupUserIds.push(owner.userId);
    const [band] = await db.insert(bands).values({ name: 'A Real Band', slug }).returning();
    if (!band) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(band.id);
    await db.insert(bandMembers).values({ bandId: band.id, userId: owner.userId, role: 'owner', instruments: [] });
    return { band, owner };
  }

  it('archives instead of deleting a non-test band under a production-like NODE_ENV, and the owner can restore it', async () => {
    const { band, owner } = await setupOwnedBand(`not-a-test-band-${randomUUID()}`);
    process.env.NODE_ENV = 'production';

    const deleteRes = await req(`/${band.id}`, 'DELETE', owner.token);
    expect(deleteRes.status).toBe(200);
    const deleteBody = (await deleteRes.json()) as { archived: boolean; permanentDeletionAt: string };
    expect(deleteBody.archived).toBe(true);
    expect(new Date(deleteBody.permanentDeletionAt).getTime()).toBeGreaterThan(Date.now());

    const [row] = await db.select({ archivedAt: bands.archivedAt }).from(bands).where(eq(bands.id, band.id));
    expect(row?.archivedAt).toBeInstanceOf(Date);

    // Hidden from the normal list while archived...
    const listRes = await listMyBands(owner.token);
    const listBody = (await listRes.json()) as { id: string }[];
    expect(listBody.some((b) => b.id === band.id)).toBe(false);

    // ...but still visible in the owner's "recently deleted" view.
    const archivedRes = await req('/archived', 'GET', owner.token);
    const archivedBody = (await archivedRes.json()) as { id: string }[];
    expect(archivedBody.some((b) => b.id === band.id)).toBe(true);

    const restoreRes = await req(`/${band.id}/restore`, 'POST', owner.token);
    expect(restoreRes.status).toBe(200);
    const [afterRestore] = await db.select({ archivedAt: bands.archivedAt }).from(bands).where(eq(bands.id, band.id));
    expect(afterRestore?.archivedAt).toBeNull();

    const listAfterRestore = await listMyBands(owner.token);
    const listAfterRestoreBody = (await listAfterRestore.json()) as { id: string }[];
    expect(listAfterRestoreBody.some((b) => b.id === band.id)).toBe(true);
  });

  it('deletes immediately, even under a production-like NODE_ENV, when the band is a test fixture', async () => {
    const { band, owner } = await setupOwnedBand(`test-immediate-${randomUUID()}`);
    process.env.NODE_ENV = 'production';

    const res = await req(`/${band.id}`, 'DELETE', owner.token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, archived: false });

    const [row] = await db.select().from(bands).where(eq(bands.id, band.id));
    expect(row).toBeUndefined();
    cleanupBandIds.splice(cleanupBandIds.indexOf(band.id), 1);
  });

  it('deletes immediately outside production, even for a non-test-fixture band', async () => {
    const { band, owner } = await setupOwnedBand(`not-a-test-band-${randomUUID()}`);
    process.env.NODE_ENV = 'development';

    const res = await req(`/${band.id}`, 'DELETE', owner.token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, archived: false });

    const [row] = await db.select().from(bands).where(eq(bands.id, band.id));
    expect(row).toBeUndefined();
    cleanupBandIds.splice(cleanupBandIds.indexOf(band.id), 1);
  });

  it('rejects a non-owner restoring an archived band', async () => {
    const { band, owner } = await setupOwnedBand(`not-a-test-band-${randomUUID()}`);
    const outsider = await signUpTestUser();
    cleanupUserIds.push(outsider.userId);
    process.env.NODE_ENV = 'production';
    await req(`/${band.id}`, 'DELETE', owner.token);

    const res = await req(`/${band.id}/restore`, 'POST', outsider.token);
    expect(res.status).toBe(403);
  });

  it('rejects restoring a band that was never archived', async () => {
    const { band, owner } = await setupOwnedBand(`not-a-test-band-${randomUUID()}`);
    const res = await req(`/${band.id}/restore`, 'POST', owner.token);
    expect(res.status).toBe(400);
  });
});
