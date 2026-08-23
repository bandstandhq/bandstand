# Architecture

## Sync model: three layers

Bandstand's offline-first, LAN-syncable design rests on three independent
sync layers. They share infrastructure (Yjs, the same Hocuspocus
connection) but solve different problems and have different persistence
guarantees — don't assume what's true of one layer holds for another.

### 1. Data — persistent, CRDT-merged

Band repertoire, setlists, and setlist items live in a Yjs document, one
per band (see [ADR-0002](adr/0002-crdt-over-rest.md) for why this is CRDT
and not a REST resource, and why it's scoped to only this data). Locally,
the document is persisted to IndexedDB via `y-indexeddb`, so a client that
has loaded a band's data once keeps working fully offline — reads and
writes both. When a connection is available, `HocuspocusProvider` syncs the
document to `apps/server`'s Hocuspocus instance over WebSocket, which
persists it to Postgres (`band_docs.yjs_state`, raw bytes; `band_docs.snapshot`,
a derived and Zod-validated JSON projection — see `apps/server/src/lib/hocuspocus.ts`).
Reconnecting after being offline merges automatically; Yjs's CRDT semantics
mean concurrent edits (including concurrent setlist reordering) merge
without manual conflict resolution.

Document shape (see `packages/core/src/yjs/snapshot.ts` for the
Zod-validated version of this):

```
Y.Map "songs"                → songId → { title, artist, key, bpm,
                                           durationSec, status, body
                                           (ChordPro), bandNotes, links,
                                           votes }
Y.Map "setlists"              → setlistId → { name, eventDate?, updatedAt }
Y.Array "items:<setlistId>"   → ordered list of { id, type, songId?,
                                                   breakMinutes?,
                                                   overrideKey? }
```

Order within a setlist is carried entirely by the `Y.Array`'s own
ordering — never by a position/index field on the item — so concurrent
inserts and reorders merge conflict-free.

### 2. Stage — ephemeral, never persisted

During a live performance, band members' devices need to know what song,
section, and scroll position everyone else is on — but none of that is
data worth keeping after the show. This uses Yjs's **Awareness** protocol
(not the document itself): each connected client broadcasts a small
payload —

```
{ userId, setlistId, itemId, scrollPct, liveTranspose, isLeaderCandidate }
```

— to every other client in the same session, with a target latency under
150ms. Nothing here touches Postgres. A live transposition set during Stage
Mode affects everyone's view for the duration of the show and is
deliberately never written back to the song's stored key.

**Status: not yet implemented.** Milestone 0 builds the plumbing this rides
on (the same Hocuspocus connection carries Awareness updates), but no
Stage Mode UI or Awareness payload exists yet — that's Phase 1 feature
work, tracked separately from this scaffolding milestone.

### 3. Files — content-addressed, S3-compatible

Attachments (charts, reference recordings, etc.) are stored in an
S3-compatible bucket, keyed by content hash rather than a generated ID, so
identical files uploaded by different members naturally dedupe. Clients
cache fetched attachments via the browser/WebView Cache API for offline
access. The `attachments` table (Postgres) holds the metadata — band, key,
filename, mime, size, uploader — not the file bytes themselves.

**Status: not yet implemented.** The `attachments` table exists in the
Drizzle schema (see `apps/server/src/db/schema/attachments.ts`), but there
is no upload endpoint and no S3/MinIO service running yet — it was
deliberately dropped from Milestone 0's `docker/compose.yml` since nothing
uses it (see the Milestone 0 plan). It comes back once attachment upload is
actually built.

## The server URL is configurable, not hardcoded

Every client stores its own server URL (default from `VITE_DEFAULT_SERVER_URL`
/ `VITE_DEFAULT_HOCUSPOCUS_URL` at build time, overridable per account at
runtime). This isn't cosmetic — it's the foundation for self-hosting and,
later, for a LAN-only "host mode" where one device on the local network
runs the sync server and other devices point at it directly instead of the
internet. Nothing in the client code should assume "there is exactly one
server" or hardcode a production URL.

## Auth

better-auth handles email/password sign-in and password-reset (no magic
link in Milestone 0 — see the Milestone 0 plan for why). Two token
mechanisms coexist by necessity, not by choice — see
[ADR-0001](adr/0001-monorepo-thin-wrapper.md)'s consequences section:
browsers use better-auth's cookie session; the Capacitor/Tauri-wrapped
contexts use the `jwt()`/`bearer()` plugins instead, since cross-origin
cookies are unreliable inside `capacitor://`/`tauri://` WebViews. Hocuspocus
authenticates each WebSocket connection via the same session/bearer lookup
(`apps/server/src/lib/hocuspocus.ts`'s `onAuthenticate`) — currently it
verifies the token only, not band membership; see
[bandstandhq/bandstand#1](https://github.com/bandstandhq/bandstand/issues/1).

## Where things live

See `CONTRIBUTING.md`'s "Repo layout" section for the directory-level map,
and the ADRs under `docs/adr/` for the reasoning behind the larger
decisions referenced above.
