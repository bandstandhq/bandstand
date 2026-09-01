// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `pnpm bands:sweep-archived` — permanently deletes any band whose 30-day
// archive grace period (packages/core/src/bands/archive.ts) has elapsed.
// Meant to run daily via cron (see docs/SELF_HOSTING.md); the owner can
// restore an archived band any time before this runs (POST
// /bands/:bandId/restore), and once it does, there's nothing left to
// restore.
import { ARCHIVE_GRACE_PERIOD_MS } from '@bandstand/core';
import { and, isNotNull, lt } from 'drizzle-orm';
import { db } from '../db/client';
import { bands } from '../db/schema/index';
import { hocuspocusServer } from '../lib/hocuspocus';

export async function runSweepArchivedBands(): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - ARCHIVE_GRACE_PERIOD_MS);
  const deleted = await db
    .delete(bands)
    .where(and(isNotNull(bands.archivedAt), lt(bands.archivedAt, cutoff)))
    .returning({ id: bands.id, name: bands.name });

  for (const band of deleted) {
    // Already closed once when the band was archived — this is only a
    // safety net for a connection somehow reopened during the grace period.
    hocuspocusServer.hocuspocus.closeConnections(band.id);
    console.log(`Permanently deleted archived band "${band.name}" (${band.id})`);
  }
  console.log(`Done. ${deleted.length} band(s) permanently deleted.`);
  return { deleted: deleted.length };
}

// Only run as a CLI when invoked directly (`pnpm bands:sweep-archived`), not when imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  runSweepArchivedBands()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
