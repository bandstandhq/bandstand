// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `pnpm blobs:gc` — a manual, self-hoster-triggered cleanup, deliberately
// not an automatic job (see docs/adr/0007-content-addressed-files.md). Two
// things get swept:
//
// 1. The shared `blobs/<sha256>` namespace is deduplicated *across every
//    band on the instance* (that's the whole point of content addressing
//    here) — so whether a hash still counts as "referenced" can only ever
//    be answered by aggregating every band's voices first, never one band
//    at a time. `onlyBandId` scopes which band's *ledger rows* get
//    reconciled (see its own comment below), but it must never scope which
//    hashes count as referenced when deciding what to delete: doing that
//    would let a `runBlobsGc(bandA)` run delete an object band B still
//    depends on, just because band A no longer references it. See
//    docs/adr/0015-staged-uploads.md for the write-side half of this same
//    "the object store has no idea bands exist" problem.
// 2. Abandoned staging uploads (`staging/<bandId>/<sha256>`, see
//    storage.ts) — a client that got a presigned URL and then never called
//    /confirm, or never PUT anything at all, leaves one of these sitting
//    around forever otherwise. Anything older than the presign URL's own
//    lifetime can no longer be a live upload in progress, so it's safe to
//    remove unconditionally.
import type { BandSnapshot } from '@bandstand/core';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { attachments, bandDocs, bands } from '../db/schema/index';
import { deleteSharedBlob, deleteStagingObject, listStagingObjects, PRESIGN_EXPIRY_SECONDS } from '../lib/storage';

function referencedHashes(snapshot: BandSnapshot): Set<string> {
  const hashes = new Set<string>();
  for (const voice of Object.values(snapshot.voices)) {
    if (voice.kind === 'files') {
      for (const file of voice.files) hashes.add(file.sha256);
    }
  }
  return hashes;
}

async function sweepAbandonedStagingUploads(): Promise<number> {
  const cutoffMs = Date.now() - PRESIGN_EXPIRY_SECONDS * 1000;
  const staged = await listStagingObjects();
  const abandoned = staged.filter((obj) => obj.lastModified.getTime() < cutoffMs);
  for (const obj of abandoned) {
    await deleteStagingObject(obj.bandId, obj.sha256);
  }
  return abandoned.length;
}

// `onlyBandId` exists so integration tests can scope a run to a single
// band they created — the shared Postgres/MinIO in CI/local dev is used by
// other integration test files concurrently, and this tool touches every
// band's data by design, so an unscoped run in a test would race with them.
// It only ever narrows which band's *ledger rows* get reconciled in this
// run — see the file header comment for why whether a hash is safe to
// delete from the *shared object store* is always decided across every
// band's own references, unconditionally, never scoped down to this one.
export async function runBlobsGc(onlyBandId?: string): Promise<{ deleted: number; kept: number }> {
  const allBandDocs = await db.select({ bandId: bandDocs.bandId, snapshot: bandDocs.snapshot }).from(bandDocs);
  const referencedByBand = new Map<string, Set<string>>();
  const referencedAcrossAllBands = new Set<string>();
  for (const doc of allBandDocs) {
    const hashes = doc.snapshot ? referencedHashes(doc.snapshot) : new Set<string>();
    referencedByBand.set(doc.bandId, hashes);
    for (const hash of hashes) referencedAcrossAllBands.add(hash);
  }

  const bandsToReconcile = onlyBandId
    ? await db.select({ id: bands.id, name: bands.name }).from(bands).where(eq(bands.id, onlyBandId))
    : await db.select({ id: bands.id, name: bands.name }).from(bands);

  let totalDeleted = 0;
  let totalKept = 0;
  const orphanedHashesThisRun = new Set<string>();

  for (const band of bandsToReconcile) {
    const ledgerRows = await db
      .select({ id: attachments.id, sha256: attachments.sha256 })
      .from(attachments)
      .where(eq(attachments.bandId, band.id));

    // This band's own reference set only — a ledger row this band's own
    // voices no longer point at is stale bookkeeping for *this band*
    // regardless of what any other band references, so its row always
    // comes out here.
    const referenced = referencedByBand.get(band.id) ?? new Set<string>();
    const orphanedForThisBand = ledgerRows.filter((row) => !referenced.has(row.sha256));

    for (const row of orphanedForThisBand) {
      await db.delete(attachments).where(eq(attachments.id, row.id));
      orphanedHashesThisRun.add(row.sha256);
    }

    totalDeleted += orphanedForThisBand.length;
    totalKept += ledgerRows.length - orphanedForThisBand.length;

    if (ledgerRows.length > 0) {
      console.log(
        `${band.name}: ${orphanedForThisBand.length} orphaned blob(s) removed, ${ledgerRows.length - orphanedForThisBand.length} kept`,
      );
    }
  }

  // The object store has no idea bands exist — a hash this run just
  // orphaned from one band's ledger is only safe to delete from the shared
  // namespace if *no* band's own voices reference it, checked against
  // every band regardless of `onlyBandId`.
  for (const hash of orphanedHashesThisRun) {
    if (!referencedAcrossAllBands.has(hash)) await deleteSharedBlob(hash);
  }

  const abandonedStaging = await sweepAbandonedStagingUploads();
  if (abandonedStaging > 0) {
    console.log(`${abandonedStaging} abandoned staging upload(s) removed.`);
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
