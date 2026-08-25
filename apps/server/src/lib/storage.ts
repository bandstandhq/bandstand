// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A thin wrapper over an S3-compatible object store (MinIO locally and in
// the default self-hosted setup, but any real S3-compatible endpoint works
// unchanged — see docs/adr/0007-content-addressed-files.md). Every object
// lives at `blobs/<sha256>`; callers never construct that key themselves.
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { assertNotDevPlaceholder } from './envGuard';

const DEV_PLACEHOLDER = 'dev-only-changeme';
assertNotDevPlaceholder('MINIO_ACCESS_KEY', process.env.MINIO_ACCESS_KEY, DEV_PLACEHOLDER);
assertNotDevPlaceholder('MINIO_SECRET_KEY', process.env.MINIO_SECRET_KEY, DEV_PLACEHOLDER);

console.error('[DIAGNOSTIC] MINIO_ENDPOINT=', process.env.MINIO_ENDPOINT, 'MINIO_ACCESS_KEY=', process.env.MINIO_ACCESS_KEY, 'MINIO_SECRET_KEY=', process.env.MINIO_SECRET_KEY, 'MINIO_BUCKET=', process.env.MINIO_BUCKET);

const BUCKET = process.env.MINIO_BUCKET ?? 'bandstand';
const PRESIGN_EXPIRY_SECONDS = 15 * 60;

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

export function presignUpload(sha256: string, mime: string): Promise<string> {
  const command = new PutObjectCommand({ Bucket: BUCKET, Key: blobKey(sha256), ContentType: mime });
  return getSignedUrl(s3, command, { expiresIn: PRESIGN_EXPIRY_SECONDS });
}

export function presignDownload(sha256: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: blobKey(sha256) });
  return getSignedUrl(s3, command, { expiresIn: PRESIGN_EXPIRY_SECONDS });
}

export async function headObject(sha256: string): Promise<{ size: number } | null> {
  try {
    const result = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: blobKey(sha256) }));
    return { size: result.ContentLength ?? 0 };
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

export async function getObjectBuffer(sha256: string): Promise<Buffer> {
  const result = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: blobKey(sha256) }));
  const chunks: Buffer[] = [];
  // The AWS SDK v3 Node body is a Readable stream.
  for await (const chunk of result.Body as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function deleteObject(sha256: string): Promise<void> {
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
