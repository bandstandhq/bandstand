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
});
