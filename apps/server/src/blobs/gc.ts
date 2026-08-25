// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `pnpm blobs:gc` — a manual, self-hoster-triggered cleanup, deliberately
// not an automatic job (see docs/adr/0007-content-addressed-files.md).
// For each band, diffs every sha256 referenced by a voice's `files` against
// that band's `attachments` ledger, and deletes whatever's unreferenced
// from both the object store and the ledger.
import type { BandSnapshot } from '@bandstand/core';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { attachments, bandDocs, bands } from '../db/schema/index';
import { deleteObject } from '../lib/storage';

function referencedHashes(snapshot: BandSnapshot): Set<string> {
  const hashes = new Set<string>();
  for (const voice of Object.values(snapshot.voices)) {
    if (voice.kind === 'files') {
      for (const file of voice.files) hashes.add(file.sha256);
    }
  }
  return hashes;
}

// `onlyBandId` exists so integration tests can scope a run to a single
// band they created — the shared Postgres/MinIO in CI/local dev is used by
// other integration test files concurrently, and this tool touches every
// band's data by design, so an unscoped run in a test would race with them.
export async function runBlobsGc(onlyBandId?: string): Promise<{ deleted: number; kept: number }> {
  const allBands = onlyBandId
    ? await db.select({ id: bands.id, name: bands.name }).from(bands).where(eq(bands.id, onlyBandId))
    : await db.select({ id: bands.id, name: bands.name }).from(bands);

  let totalDeleted = 0;
  let totalKept = 0;

  for (const band of allBands) {
    const [doc] = await db.select({ snapshot: bandDocs.snapshot }).from(bandDocs).where(eq(bandDocs.bandId, band.id));
    const referenced = doc?.snapshot ? referencedHashes(doc.snapshot) : new Set<string>();

    const ledgerRows = await db
      .select({ id: attachments.id, sha256: attachments.sha256 })
      .from(attachments)
      .where(eq(attachments.bandId, band.id));

    const orphaned = ledgerRows.filter((row) => !referenced.has(row.sha256));

    for (const row of orphaned) {
      await deleteObject(row.sha256);
      await db.delete(attachments).where(eq(attachments.id, row.id));
    }

    totalDeleted += orphaned.length;
    totalKept += ledgerRows.length - orphaned.length;

    if (ledgerRows.length > 0) {
      console.log(`${band.name}: ${orphaned.length} orphaned blob(s) removed, ${ledgerRows.length - orphaned.length} kept`);
    }
  }

  console.log(`Done. ${totalDeleted} blob(s) removed, ${totalKept} still referenced.`);
  return { deleted: totalDeleted, kept: totalKept };
}

// Only run as a CLI when invoked directly (`pnpm blobs:gc`), not when
// imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  runBlobsGc()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
