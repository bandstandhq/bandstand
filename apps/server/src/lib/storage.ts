// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A thin wrapper over an S3-compatible object store (MinIO locally and in
// the default self-hosted setup, but any real S3-compatible endpoint works
// unchanged). A confirmed blob lives at the shared, global key
// `blobs/<sha256>` — deliberately deduplicated across every band on the
// instance (docs/adr/0007-content-addressed-files.md). A client-facing
// upload is never written there directly, though: it PUTs to a per-band
// staging key (`staging/<bandId>/<sha256>`) first, and only ever reaches
// the shared namespace via `promoteStagingObject`'s server-side copy, once
// routes/files.ts has re-hashed the staging object and confirmed it matches
// the claimed sha256 — see docs/adr/0015-staged-uploads.md for why a
// presigned PUT straight into the shared namespace let one band overwrite
// (or, via a failed /confirm's old cleanup step, delete) another band's
// blob. Callers never construct either key themselves.
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { assertNotDevPlaceholder } from './envGuard';

const DEV_PLACEHOLDER = 'dev-only-changeme';
assertNotDevPlaceholder('MINIO_ACCESS_KEY', process.env.MINIO_ACCESS_KEY, DEV_PLACEHOLDER);
assertNotDevPlaceholder('MINIO_SECRET_KEY', process.env.MINIO_SECRET_KEY, DEV_PLACEHOLDER);

const BUCKET = process.env.MINIO_BUCKET ?? 'bandstand';
export const PRESIGN_EXPIRY_SECONDS = 15 * 60;

const s3 = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
  region: 'us-east-1', // MinIO ignores this, but the SDK requires a value.
  forcePathStyle: true, // MinIO (and most self-hosted S3-alikes) needs path-style, not virtual-hosted-style, addressing.
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY ?? DEV_PLACEHOLDER,
    secretAccessKey: process.env.MINIO_SECRET_KEY ?? DEV_PLACEHOLDER,
  },
});

function blobKey(sha256: string): string {
  return `blobs/${sha256}`;
}

function stagingKey(bandId: string, sha256: string): string {
  return `staging/${bandId}/${sha256}`;
}

// CopyObjectCommand's `CopySource` wants "<bucket>/<key>" with each path
// *segment* percent-encoded but the `/` separators left alone —
// encodeURIComponent on the whole string would also escape those, breaking
// the source reference.
function encodeS3Path(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function presignStagingUpload(bandId: string, sha256: string, mime: string): Promise<string> {
  const command = new PutObjectCommand({ Bucket: BUCKET, Key: stagingKey(bandId, sha256), ContentType: mime });
  return getSignedUrl(s3, command, { expiresIn: PRESIGN_EXPIRY_SECONDS });
}

export function presignDownload(sha256: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: blobKey(sha256) });
  return getSignedUrl(s3, command, { expiresIn: PRESIGN_EXPIRY_SECONDS });
}

export async function headObject(sha256: string): Promise<{ size: number; lastModified: Date | undefined } | null> {
  try {
    const result = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: blobKey(sha256) }));
    return { size: result.ContentLength ?? 0, lastModified: result.LastModified };
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

export async function headStagingObject(bandId: string, sha256: string): Promise<{ size: number } | null> {
  try {
    const result = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: stagingKey(bandId, sha256) }));
    return { size: result.ContentLength ?? 0 };
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

/** The AWS SDK v3 Node body is a Readable stream — callers that need the full content buffer it themselves (see routes/files.ts's own TODO on hashing it without doing so). */
export async function getStagingObjectStream(bandId: string, sha256: string): Promise<AsyncIterable<Buffer>> {
  const result = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: stagingKey(bandId, sha256) }));
  return result.Body as AsyncIterable<Buffer>;
}

export function deleteStagingObject(bandId: string, sha256: string): Promise<void> {
  return s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: stagingKey(bandId, sha256) })).then(() => undefined);
}

export interface StagingObjectInfo {
  bandId: string;
  sha256: string;
  lastModified: Date;
}

/**
 * Every object currently sitting under the shared `staging/` prefix, across
 * every band — for blobs/gc.ts's abandoned-upload sweep (a client that
 * never called /confirm, or never PUT anything at all, leaves one of these
 * behind forever otherwise). A key that doesn't parse back into exactly
 * `staging/<bandId>/<sha256>` is skipped rather than crashing the whole
 * sweep over one malformed entry.
 */
export async function listStagingObjects(): Promise<StagingObjectInfo[]> {
  const results: StagingObjectInfo[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'staging/', ContinuationToken: continuationToken }),
    );
    for (const obj of page.Contents ?? []) {
      if (!obj.Key || !obj.LastModified) continue;
      const [prefix, bandId, sha256, ...rest] = obj.Key.split('/');
      if (prefix !== 'staging' || !bandId || !sha256 || rest.length > 0) continue;
      results.push({ bandId, sha256, lastModified: obj.LastModified });
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return results;
}

/**
 * Server-side copy from a band's own verified staging object into the
 * shared, deduplicated `blobs/<sha256>` key — bytes never pass through this
 * process. Only ever call this once routes/files.ts has re-hashed the
 * staging object and confirmed it matches `sha256`; this function has no
 * way to check that itself, and overwrites unconditionally.
 */
export function promoteStagingObject(bandId: string, sha256: string): Promise<void> {
  const command = new CopyObjectCommand({
    Bucket: BUCKET,
    Key: blobKey(sha256),
    CopySource: encodeS3Path(`${BUCKET}/${stagingKey(bandId, sha256)}`),
  });
  return s3.send(command).then(() => undefined);
}

/**
 * Deletes from the *shared*, cross-band `blobs/<sha256>` namespace — must
 * only ever be called after aggregating referenced hashes across **all**
 * bands (see blobs/gc.ts's own comment), never in response to one band's
 * own action. Nothing else may call this: a presigned upload can no longer
 * reach this key directly at all (see docs/adr/0015-staged-uploads.md), and
 * a failed /confirm now only ever deletes the *staging* object.
 */
export function deleteSharedBlob(sha256: string): Promise<void> {
  return s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: blobKey(sha256) })).then(() => undefined);
}

/** For A5's seed script, which uploads directly rather than through a presigned URL (it isn't a real client). */
export function putObjectDirect(sha256: string, body: Buffer, mime: string): Promise<void> {
  return s3
    .send(new PutObjectCommand({ Bucket: BUCKET, Key: blobKey(sha256), Body: body, ContentType: mime }))
    .then(() => undefined);
}

function isNotFoundError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && '$metadata' in err && (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;
}
