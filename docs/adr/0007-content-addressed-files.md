# ADR-0007: File attachments are content-addressed, uploaded via presigned URLs, and garbage-collected manually

## Context

Milestone 2 gives musicians who read written parts (horns, strings, keys) their own PDF/image
voice for a song, instead of forcing everyone through ChordPro (see ADR-0004, which already
scoped `voices` to support this additively). That means real binary files enter the system for
the first time since the Milestone-0 MinIO removal, and three concerns follow directly from how a
self-hosted band tool is actually used:

1. **Duplication.** A band's five horn players commonly all have the exact same PDF part. Keying
   storage by filename (or a fresh random id per upload) would store that file five times.
2. **Integrity.** The server can't simply trust a client's claimed file identity — a manipulated
   or buggy client could claim a hash it didn't actually upload.
3. **Self-hosting cost.** Bandstand explicitly targets small self-hosted deployments (see
   README's "no seat limits, self-host with `docker compose up`"). An automatic cleanup job adds a
   background process a self-hoster has to trust and monitor for a problem (storage growth) that
   is neither urgent nor silent if left alone.

**Update (see [ADR-0015](0015-staged-uploads.md))**: a presigned upload no longer PUTs directly at
`blobs/<sha256>` as described below — it lands at a band-scoped staging key first, and only a
server-verified copy ever reaches the shared key. The global, deduplicated namespace this ADR
establishes is otherwise unchanged; ADR-0015 covers why the direct-PUT version of it let one band
overwrite or delete another's blob.

## Decision

- **Storage key is `blobs/<sha256>`, not a filename or generated id.** The client computes the
  hash (`packages/core/src/files/hash.ts`, `sha256Hex` — one implementation shared between browser
  and server via the Web Crypto API's `crypto.subtle`, no separate Node-only hashing path) before
  ever offering the file to the server. If a blob with that hash already exists for the band, no
  bytes are transferred — only the `{sha256, filename, mime, pageCount}` reference
  (`packages/core/src/files/schema.ts`'s `fileRefSchema`) is added to the voice. `filename` is
  carried purely as a per-reference display name; it is explicitly not part of a file's identity,
  so two members can call the same blob different things.
- **Upload and download go through presigned URLs, never through the application server.** The
  server's role is: decide whether a hash is already known (Postgres lookup), issue a presigned
  PUT/GET against the object store, and — after upload — re-hash the bytes it can read back from
  the store to confirm they actually match the claimed `sha256`, rejecting and deleting the object
  on mismatch. The server is never a passthrough for file bytes.
- **A per-band content ledger, not a per-voice-file foreign key.** The existing (currently
  unused) `attachments` Postgres table becomes one row per `(bandId, sha256)` — it exists so "does
  this blob already exist for this band" is a fast lookup and so garbage collection has something
  to reconcile against, not because a voice's file references point at it. A voice's `files` array
  stores `{sha256, filename, mime, pageCount}` inline, directly in the Yjs document.
- **Garbage collection is a manual `pnpm blobs:gc` script, not an automatic job.** It scans every
  band's live voices for referenced hashes, diffs against that band's ledger rows, and deletes
  anything unreferenced from both the object store and the ledger. A self-hoster runs it when they
  care to reclaim space; nothing runs unattended.
- **Allowed types are PDF, PNG, and JPEG; size limit is configurable, default 50MB/file**
  (`ALLOWED_FILE_MIME_TYPES`, `DEFAULT_MAX_FILE_SIZE_BYTES` in `packages/core/src/files/schema.ts`,
  overridable via the server's `MAX_FILE_SIZE_BYTES` env var).
- **Permissions**: `file:upload` is a `member`-level action (adding a part is ordinary creative
  contribution, like creating a song); `file:detach` (removing a file reference from a voice) is
  `admin`-level, mirroring `song:deleteForever` — see `packages/core/src/permissions/matrix.ts` and
  `docs/PERMISSIONS.md`.

## Consequences

- `attachments.key` and `attachments.song_id` are dropped in the same migration that adds
  `sha256` — both are now either fully derivable (`key` = `blobs/<sha256>`) or meaningless (a blob
  is band-scoped and can be referenced by any voice on any song, not tied to the song it was first
  uploaded for). No migration script preserves old rows, following the same precedent ADR-0004
  set: the table has zero live readers today, so there's no real data to carry forward.
- `file:detach`'s mutation goes through `withBandDoc` (a REST endpoint, not a client's own CRDT
  write) for the same reason `song:deleteForever` does. Unlike that action, this ADR does **not**
  extend the manipulated-client CRDT-bypass guard (`apps/server/src/lib/hocuspocus.ts`'s
  `onChange` hook, see ADR-0005) to police shrinkage of a voice's `files` array — that guard's
  scope stays deliberately narrow (whole-key removal from `songs`/`setlists` only). A member who
  bypasses the UI and edits the CRDT directly to remove a file gets the same level of protection
  every other member-vs-admin distinction gets outside those two guarded maps: a REST re-check,
  not a live revert. If file removal turns out to need the stronger guarantee in practice, that's
  a follow-up, not something this round builds speculatively.
- Presigned uploads mean the browser talks to the object store directly, so the object store's
  CORS policy must allow the web app's origin for PUT and GET — set from the `WEB_ORIGIN` env var
  at bucket-init time (`docker/compose.yml`), not hardcoded, so it doesn't silently work only in
  local dev and break for every self-hoster on a different origin.
- A self-hosted MinIO deployment ships with placeholder access credentials in `.env.example`
  (`dev-only-changeme`, matching the existing `BETTER_AUTH_SECRET` convention). Because
  `docker/Dockerfile.server` already sets `NODE_ENV=production`, the server hard-fails at startup
  if it finds those placeholders still in place in a production environment, rather than silently
  running with them — a self-hoster who copies the example file and never edits it is a realistic
  failure mode to guard against, not a hypothetical one.
