// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Real Postgres. Proves the sweeper only touches a band whose 30-day grace
// period has actually elapsed — an archived-yesterday band must survive a
// run just as reliably as a never-archived one.
import { randomUUID } from 'node:crypto';
import { ARCHIVE_GRACE_PERIOD_MS } from '@bandstand/core';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { bands } from '../db/schema/index';
import { runSweepArchivedBands } from './sweepArchived';

describe('runSweepArchivedBands (integration)', () => {
  const cleanupBandIds: string[] = [];

  afterAll(async () => {
    for (const bandId of cleanupBandIds) await db.delete(bands).where(eq(bands.id, bandId));
  });

  it('permanently deletes a band whose grace period has elapsed, but leaves everything else alone', async () => {
    const overdue = await db
      .insert(bands)
      .values({
        name: 'Overdue Band',
        slug: `test-sweep-overdue-${randomUUID()}`,
        archivedAt: new Date(Date.now() - ARCHIVE_GRACE_PERIOD_MS - 1000 * 60),
      })
      .returning();
    const recentlyArchived = await db
      .insert(bands)
      .values({
        name: 'Recently Archived Band',
        slug: `test-sweep-recent-${randomUUID()}`,
        archivedAt: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
      })
      .returning();
    const neverArchived = await db
      .insert(bands)
      .values({ name: 'Never Archived Band', slug: `test-sweep-never-${randomUUID()}` })
      .returning();
    const overdueId = overdue[0]!.id;
    const recentId = recentlyArchived[0]!.id;
    const neverId = neverArchived[0]!.id;
    cleanupBandIds.push(recentId, neverId); // overdueId is expected to already be gone

    const result = await runSweepArchivedBands();
    expect(result.deleted).toBeGreaterThanOrEqual(1);

    const [overdueRow] = await db.select().from(bands).where(eq(bands.id, overdueId));
    expect(overdueRow).toBeUndefined();

    const [recentRow] = await db.select().from(bands).where(eq(bands.id, recentId));
    expect(recentRow).toBeDefined();

    const [neverRow] = await db.select().from(bands).where(eq(bands.id, neverId));
    expect(neverRow).toBeDefined();
  });
});
