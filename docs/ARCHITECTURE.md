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
writes both. This local cache is scoped per user, not just per band
(`bandstand:<userId>:<bandId>`), and is only ever exposed to the UI once
this device's current user is confirmed — or, offline, was last confirmed
— to still be a band member; see [ADR-0006](adr/0006-offline-cache-scoping.md)
for the full membership-gating design and its one unavoidable remaining
limit (a device kept offline on purpose keeps whatever it last synced).
When a connection is available, `HocuspocusProvider` syncs the
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
                                           durationSec, status, bandNotes,
                                           links, votes }
Y.Map "voices"                → voiceId → a chordpro voice { songId, name,
                                           body } or a files voice
                                           { songId, name, files,
                                           displayRecipe?, anchorMap? } —
                                           see ADR-0008/0009/0010
Y.Map "assignments"           → "<songId>:<userId>" → voiceId
Y.Array "anchors:<songId>"    → ordered list of { id, label, order, bar?,
                                                   timeMs? } — see ADR-0010
Y.Map "setlists"              → setlistId → { name, eventDate?, updatedAt }
Y.Array "items:<setlistId>"   → ordered list of { id, type, songId?,
                                                   breakMinutes?,
                                                   overrideKey? }
Y.Map "events"                → eventId → { type, title, startsAt, endsAt?,
                                             allDay, location?, locationGeo?,
                                             notes?, setlistId?, status,
                                             seriesId?, seriesRule?,
                                             occurrenceDate? } — a
                                             recurring series is a template
                                             plus exception entries, never
                                             one row per generated date; see
                                             ADR-0011
Y.Map "availability"          → "<occurrenceId>:<userId>" → 'yes'|'maybe'|'no'
                                             — occurrenceId is a real events
                                             key, or a virtual occurrence's
                                             synthetic "<templateId>@<date>"
                                             id (see ADR-0011)
Y.Map "polls"                 → pollId → { title, notes?, options, closesAt?,
                                            resolvedEventId? }
Y.Map "pollVotes"             → "<pollId>:<optionId>:<userId>" → 'yes'|'maybe'|'no'
```

A song's ChordPro content lives on a voice, not the song itself — see
[ADR-0004](adr/0004-parts-and-anchors.md). Milestone 1 always created
exactly one voice per song (at `getDefaultVoiceId(songId)`); Milestone 2
made that additive — any number of voices per song, of either kind (see
[ADR-0008](adr/0008-multi-voice-songs.md)) — and added the shared anchor
list every voice's own position maps into
([ADR-0010](adr/0010-anchor-sync.md)).

Order within a setlist is carried entirely by the `Y.Array`'s own
ordering — never by a position/index field on the item — so concurrent
inserts and reorders merge conflict-free.

Milestone 3 added calendar events, availability, and scheduling polls to
this same document — see [ADR-0011](adr/0011-calendar-events.md) for the
recurring-series-as-template design, the synthetic occurrence-id scheme
`availability` uses, and the amendment it makes to the manipulated-client
guard below (`availability`/`pollVotes` need a different kind of check
than whole-key deletion). The read-only ICS subscription feed
(`GET /calendar/:token.ics`, `apps/server/src/routes/calendarFeed.ts`) is
the one place band data leaves this document for an unauthenticated,
token-only HTTP client — it rechecks the token holder's band memberships
fresh from Postgres on every single request, never from a cache.

### 2. Stage — ephemeral, never persisted

During a live performance, band members' devices need to know what song and
musical position everyone else is on — but none of that is data worth
keeping after the show. This uses Yjs's **Awareness** protocol (not the
document itself): each connected client broadcasts a small payload under
the `'stage'` awareness field —

```
{ userId, setlistId, itemId, position?: { anchorId, fraction },
  liveTranspose, isLeaderCandidate }
```

(`StageAwarenessState`, `packages/core/src/schemas/stageAwareness.ts`) — to
every other client in the same band doc's connection, over the same
WebSocket the document itself syncs over. Nothing here touches Postgres. A
live transposition set during Stage Mode affects everyone's view for the
duration of the show and is deliberately never written back to the song's
stored key. `position` is a logical anchor, never a rendering coordinate —
see [ADR-0004](adr/0004-parts-and-anchors.md) for why that type exists and
[ADR-0010](adr/0010-anchor-sync.md) for the anchor-based design it grew
into once a song could have several voices of genuinely different kinds
(a chorister's ChordPro, a horn player's scanned PDF). `position` is
`undefined` entirely at the two lower rungs of ADR-0010's four-level
fallback ladder — a page number, when that's the best available signal,
still travels through `anchorId` as a synthetic id, never a field of its
own; the wire shape never grows a second, rendering-coordinate-shaped
field under any name.

**Status: implemented (Milestone 2).** `apps/web/src/pages/StageMode.tsx`
broadcasts and subscribes to this payload for Follow Mode (any member can
follow any other; a manual scroll or page turn pauses it, with a "Back to
`<name>`" control to resume), a small sync-level indicator, and the
live-transpose display. See [ADR-0006](adr/0006-offline-cache-scoping.md)
for the related — but separate — concern of gating the underlying band
doc's *local cache* on membership; that ADR isn't about this Awareness
layer, which was never persisted or cached to begin with.

### 3. Files — content-addressed, S3-compatible

Voice attachments (scanned parts, chart PDFs) are stored in an
S3-compatible bucket (MinIO locally and by default self-hosted; any real
S3-compatible endpoint works unchanged) keyed by content hash
(`blobs/<sha256>`) rather than a generated ID, so identical files uploaded
by different members naturally dedupe — see
[ADR-0007](adr/0007-content-addressed-files.md) for the full design
(presigned uploads/downloads, server-side hash re-verification, manual
`pnpm blobs:gc`). The browser talks to the object store directly for the
actual bytes, never through the app server. The `attachments` table
(Postgres) is a per-band ledger of known blobs — band, sha256, display
filename, mime, size, uploader — not the file bytes themselves, and not a
foreign key from a voice (a voice's `files` array stores
`{sha256, filename, mime, pageCount}` inline in the Yjs document; see
[ADR-0008](adr/0008-multi-voice-songs.md)). Clients cache fetched blobs via
the browser/WebView Cache API for offline access — every file referenced by
an upcoming setlist is pre-loaded in the background, with a readiness
indicator showing progress (Milestone 2 Part A / A4, done; see
`OfflineReadiness.tsx`).

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
(`apps/server/src/lib/hocuspocus.ts`'s `onAuthenticate`), then checks that
the authenticated user is actually a member of the requested band
(`documentName` is the `bandId`) via the same `getBandMembership` helper
REST routes use — a non-member's connection is rejected outright, with an
explicit `'not-a-member'` reason (`HOCUSPOCUS_AUTH_FAILURE_REASON`) the
client uses to distinguish "genuinely not a member" from "server/network
unreachable" and react accordingly — see
[ADR-0006](adr/0006-offline-cache-scoping.md).

## Where things live

See `CONTRIBUTING.md`'s "Repo layout" section for the directory-level map,
and the ADRs under `docs/adr/` for the reasoning behind the larger
decisions referenced above.
