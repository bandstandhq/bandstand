# ADR-0015: Uploads land in a band-scoped staging key, never directly in the shared blob namespace

## Context

ADR-0007 put every file at a single, global, content-addressed key: `blobs/<sha256>`, deliberately
deduplicated across every band on the instance — five bands with the same stock arrangement store
it once. The August 2026 security review's finding 2 closed the **read** side of the gap that
design leaves open: without `pending_uploads` and a `baselineLastModified` check, `/confirm` could
be satisfied by *any* object already sitting at a hash, letting a band "adopt" a blob it never
uploaded, just by knowing its hash (realistic — a full repertoire export includes every
`files[].sha256`).

That fix left the **write** side wide open. `/presign-upload` hands out a presigned PUT straight
against `blobs/<sha256>` without any regard for whether another band's object already lives there.
Any member of any band, knowing a victim band's hash, could:

1. Call `/presign-upload` for that hash from their own band → a valid PUT URL for `blobs/<sha256>`.
2. PUT arbitrary bytes with an allowed mime type → the victim band's object is silently replaced.
   Every member of the victim band is now served the substituted content under the original
   filename — content addressing means nothing here revalidates a hash still points at what it
   used to, since the whole design's promise is that it always does.
3. Optionally call `/confirm` with the same hash → the hash mismatch branch called
   `deleteObject(sha256)` on the **shared** key → the victim band's object is destroyed outright,
   leaving a dangling ledger row and a broken voice reference.

A single authenticated member, the lowest role in the system, could silently corrupt or destroy
another band's files. The same bug shape existed independently in `blobs/gc.ts`, which computed
"orphaned" per band but deleted from the shared, cross-band namespace — one `pnpm blobs:gc` run
could delete a blob a *different* band still legitimately references.

## Options considered

- **Band-scoped storage keys** (`blobs/<bandId>/<sha256>`), dropping the shared namespace
  entirely. Solves the overwrite/delete problem outright, but throws away the dedup ADR-0007 was
  built around — five bands with the same PDF would each store their own copy, and a second band
  uploading identical bytes could no longer just prove possession by re-uploading; the property
  finding 2 introduced (uploading the bytes *is* how a band earns its ledger row) would need a
  different mechanism entirely. Rejected: this doesn't fix a bug in the design, it abandons a
  deliberate part of it.
- **Conditional PUT** (`If-None-Match: *`, refusing to overwrite an existing object) on the direct
  `blobs/<sha256>` presign. Would stop the overwrite, but not the delete (a mismatch still has to
  clean up *something*, and that something is still the shared key), and support for conditional
  writes varies across S3-compatible object stores — MinIO's own behavior here isn't a given the
  way a bucket-wide setting is (see ADR-0007's CORS section for a MinIO deviation of exactly this
  shape). Rejected: partial fix, and depends on object-store behavior Bandstand can't guarantee
  for every self-hoster's backend.
- **Staging + verify + promote** (chosen): a presigned PUT never targets the shared namespace at
  all. It goes to a **band-scoped** staging key; the server re-hashes *that* band's own staged
  object, and only a verified match is ever copied (server-side, no bytes through this process)
  into the shared `blobs/<sha256>` key. A failed verification deletes only the staging object.

## Decision

- New per-band staging key: `staging/<bandId>/<sha256>` (`storage.ts`'s `stagingKey`, alongside the
  existing `blobKey`). `/presign-upload` signs a PUT against this key, never `blobs/<sha256>`.
- `/confirm` re-hashes the **staging** object (not the shared one), and only on a match calls a new
  `promoteStagingObject`: a server-side `CopyObjectCommand` from the staging key to `blobs/<sha256>`.
  Bytes never pass through this server for that copy. The staging object is deleted either way
  (mismatch or success) — it's disposable once /confirm has resolved it one way or the other.
- A mismatch (`deleteStagingObject`) can never touch `blobs/`. The exported `deleteObject` function
  is renamed to `deleteSharedBlob` and re-scoped to a single call site: `blobs/gc.ts`, and only
  after it has aggregated referenced hashes across **every** band, never one band's own view.
- `pending_uploads`' `baselineLastModified` column (finding 2's own fix) becomes unnecessary and is
  dropped. It existed to answer "did *this band's* PUT actually just happen, or does that object
  predate this request" in a namespace with no band-scoping at all — a comparison that needs no
  clock reasoning once the object a band's PUT lands on is *itself* already band-scoped. The
  staged object's mere existence, checked with a plain `HeadObject`, is now sufficient proof.
- `blobs/gc.ts` also sweeps `staging/` objects older than the presigned URL's own lifetime — a
  client that got a presign and never called `/confirm` (or never PUT anything) would otherwise
  leave that object behind forever.

## Consequences

- Extra storage, briefly: every upload now touches two objects (staging, then the promoted shared
  copy) instead of one, for the lifetime of one `/confirm` call. The staging object is deleted
  immediately after promotion, so steady-state storage is unchanged; only abandoned uploads
  (covered by the gc sweep above) linger.
- `blobs/gc.ts` gains a second responsibility (sweeping stale staging objects) beyond its original
  per-band ledger reconciliation — still triggered manually via `pnpm blobs:gc`, per ADR-0007,
  not a new background job.
- The shared `blobs/<sha256>` namespace is now write-once from any client's perspective: nothing
  reachable from a request ever deletes from it except gc, and nothing ever PUTs to it directly at
  all — the only way bytes reach it is the server's own `promoteStagingObject` copy, gated on a
  hash check this same request just performed.
- No client-side change: `apps/web/src/lib/uploadFile.ts` PUTs to whatever URL the server returns,
  with no assumption baked in about which key that URL points at.
