// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Needs a real Postgres (DATABASE_URL) — see vitest.integration.config.ts
// and .github/workflows/ci.yml's `integration` job. Proves the new CI
// wiring actually reaches a real database, not just that it starts up.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { bandMembers, bands, users } from '../db/schema/index';
import { getBandMembership } from './bandAuthz';

// TEMP debug
const _u = new URL(process.env.DATABASE_URL ?? 'postgres://missing');
console.error(
  'TEMP DEBUG DATABASE_URL as seen inside vitest process:',
  JSON.stringify({
    passType: typeof _u.password,
    passLen: _u.password.length,
    user: _u.username,
    host: _u.hostname,
  }),
);

async function createTestUserAndBand(role: 'owner' | 'admin' | 'member') {
  const suffix = randomUUID();
  const [user] = await db
    .insert(users)
    .values({ email: `integration-${suffix}@bandstand.local`, name: 'Integration Test User' })
    .returning();
  const [band] = await db
    .insert(bands)
    .values({ name: 'Integration Test Band', slug: `integration-test-band-${suffix}` })
    .returning();
  if (!user || !band) throw new Error('Setup insert returned no row');
  await db.insert(bandMembers).values({ bandId: band.id, userId: user.id, role, instruments: [] });
  return { userId: user.id, bandId: band.id };
}

describe('getBandMembership (integration)', () => {
  const cleanup: { userId: string; bandId: string }[] = [];

  afterAll(async () => {
    for (const { userId, bandId } of cleanup) {
      // bandMembers cascades on band deletion (see db/schema/bandMembers.ts).
      await db.delete(bands).where(eq(bands.id, bandId));
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it('returns the real role for an actual member', async () => {
    const { userId, bandId } = await createTestUserAndBand('admin');
    cleanup.push({ userId, bandId });

    const membership = await getBandMembership(bandId, userId);
    expect(membership).toEqual({ role: 'admin' });
  });

  it('returns null for a user who is not a member of that band', async () => {
    const { userId, bandId } = await createTestUserAndBand('owner');
    cleanup.push({ userId, bandId });

    const membership = await getBandMembership(bandId, randomUUID());
    expect(membership).toBeNull();
  });
});
