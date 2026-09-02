// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Real Postgres + a real MinIO — proves runBlobsGc() actually reconciles
// against live storage, not just that its diffing logic is correct in
// isolation.
import { randomUUID } from 'node:crypto';
import { getDefaultVoiceId, yDocToSnapshot } from '@bandstand/core';
import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { attachments, bandDocs, bands } from '../db/schema/index';
import { headObject, putObjectDirect } from '../lib/storage';
import { runBlobsGc } from './gc';

async function setupBandWithBlobs() {
  const [band] = await db
    .insert(bands)
    .values({ name: 'GC Test Band', slug: `test-gc-test-${randomUUID()}` })
    .returning();
  if (!band) throw new Error('Setup insert returned no row');

  const songId = `song-${randomUUID()}`;
  const referencedSha256 = randomUUID().replace(/-/g, '').padEnd(64, '0');
  const orphanedSha256 = randomUUID().replace(/-/g, '').padEnd(64, '1');

  const doc = new Y.Doc();
  doc.getMap('songs').set(songId, {
    title: 'GC Test Song',
    artist: '',
    key: 'C',
    bpm: 120,
    durationSec: 180,
    status: 'active',
    bandNotes: '',
    links: [],
    votes: {},
  });
  doc.getMap('voices').set(getDefaultVoiceId(songId), {
    songId,
    name: 'Trumpet',
    kind: 'files',
    files: [{ sha256: referencedSha256, filename: 'part.pdf', mime: 'application/pdf', pageCount: 1 }],
  });

  await db.insert(bandDocs).values({
    bandId: band.id,
    yjsState: Buffer.from(Y.encodeStateAsUpdate(doc)),
    snapshot: yDocToSnapshot(doc),
  });

  await db.insert(attachments).values([
    { bandId: band.id, sha256: referencedSha256, filename: 'part.pdf', mime: 'application/pdf', size: 10 },
    { bandId: band.id, sha256: orphanedSha256, filename: 'unused.pdf', mime: 'application/pdf', size: 10 },
  ]);

  await putObjectDirect(referencedSha256, Buffer.from('referenced'), 'application/pdf');
  await putObjectDirect(orphanedSha256, Buffer.from('orphaned'), 'application/pdf');

  return { band, referencedSha256, orphanedSha256 };
}

describe('runBlobsGc (integration)', () => {
  const cleanupBandIds: string[] = [];

  afterAll(async () => {
    for (const bandId of cleanupBandIds) await db.delete(bands).where(eq(bands.id, bandId));
  });

  it('deletes an orphaned blob from the store and the ledger, but keeps a referenced one', async () => {
    const { band, referencedSha256, orphanedSha256 } = await setupBandWithBlobs();
    cleanupBandIds.push(band.id);

    await runBlobsGc(band.id);

    expect(await headObject(referencedSha256)).not.toBeNull();
    expect(await headObject(orphanedSha256)).toBeNull();

    const remaining = await db.select().from(attachments).where(eq(attachments.bandId, band.id));
    expect(remaining.map((r) => r.sha256)).toEqual([referencedSha256]);
  });

  // Regression test for docs/adr/0015-staged-uploads.md: the object store
  // has no idea bands exist, so "is this hash still referenced" can only
  // ever be answered by looking across every band, never one at a time —
  // the old per-band-only check let a `runBlobsGc(bandA)` run delete a blob
  // band B still legitimately depends on.
  it("scoping a gc run to one band never deletes a blob a different band still references", async () => {
    const sharedSha256 = randomUUID().replace(/-/g, '').padEnd(64, '2');

    const [bandA] = await db.insert(bands).values({ name: 'GC Band A', slug: `test-gc-a-${randomUUID()}` }).returning();
    const [bandB] = await db.insert(bands).values({ name: 'GC Band B', slug: `test-gc-b-${randomUUID()}` }).returning();
    if (!bandA || !bandB) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(bandA.id, bandB.id);

    // Band A no longer references the shared hash (its own voice was
    // already changed/removed) — only its stale ledger row remains. Band B
    // still genuinely references it.
    const songIdA = `song-${randomUUID()}`;
    const docA = new Y.Doc();
    docA.getMap('songs').set(songIdA, {
      title: 'Band A Song', artist: '', key: 'C', bpm: 120, durationSec: 180, status: 'active', bandNotes: '', links: [], votes: {},
    });
    docA.getMap('voices').set(getDefaultVoiceId(songIdA), { songId: songIdA, name: 'Vocal', body: '' });
    await db.insert(bandDocs).values({ bandId: bandA.id, yjsState: Buffer.from(Y.encodeStateAsUpdate(docA)), snapshot: yDocToSnapshot(docA) });
    await db.insert(attachments).values({ bandId: bandA.id, sha256: sharedSha256, filename: 'shared.pdf', mime: 'application/pdf', size: 10 });

    const songIdB = `song-${randomUUID()}`;
    const docB = new Y.Doc();
    docB.getMap('songs').set(songIdB, {
      title: 'Band B Song', artist: '', key: 'C', bpm: 120, durationSec: 180, status: 'active', bandNotes: '', links: [], votes: {},
    });
    docB.getMap('voices').set(getDefaultVoiceId(songIdB), {
      songId: songIdB, name: 'Trumpet', kind: 'files', files: [{ sha256: sharedSha256, filename: 'shared.pdf', mime: 'application/pdf', pageCount: 1 }],
    });
    await db.insert(bandDocs).values({ bandId: bandB.id, yjsState: Buffer.from(Y.encodeStateAsUpdate(docB)), snapshot: yDocToSnapshot(docB) });
    await db.insert(attachments).values({ bandId: bandB.id, sha256: sharedSha256, filename: 'shared.pdf', mime: 'application/pdf', size: 10 });

    await putObjectDirect(sharedSha256, Buffer.from('shared content'), 'application/pdf');

    await runBlobsGc(bandA.id);

    // Band A's own stale ledger row is gone...
    const remainingA = await db.select().from(attachments).where(eq(attachments.bandId, bandA.id));
    expect(remainingA).toEqual([]);
    // ...band B's is untouched...
    const remainingB = await db.select().from(attachments).where(eq(attachments.bandId, bandB.id));
    expect(remainingB.map((r) => r.sha256)).toEqual([sharedSha256]);
    // ...and the object itself is still there, because band B still
    // references it — this is the exact case the old per-band-only check
    // got wrong.
    expect(await headObject(sharedSha256)).not.toBeNull();
  });
});
