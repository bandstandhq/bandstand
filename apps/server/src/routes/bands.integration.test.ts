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
