# ADR-0002: Yjs/CRDT for band documents, not a classic REST API

## Context

A band's repertoire and setlists are edited by multiple members at once —
often in the same rehearsal room, sometimes offline (spotty venue wifi is
the norm, not the exception). Reordering a setlist during a live set while
someone else is also editing it is a realistic scenario, and the app must
work fully offline once data has been loaded once.

## Options considered

1. **REST + optimistic locking / last-write-wins.** Simple, familiar, but
   concurrent setlist reordering either conflicts destructively or silently
   drops one person's edit. Doesn't support true offline editing with
   automatic merge on reconnect.
2. **REST + operational transform.** Solves the merge problem but OT is
   notoriously hard to implement correctly and has little off-the-shelf
   tooling compared to CRDTs.
3. **Yjs (CRDT) via Hocuspocus**, with `y-indexeddb` for local persistence
   and `y-websocket`/Hocuspocus for server sync.

## Decision

Option 3, but **scoped to `band_docs` only** — songs, setlists, and setlist
items. This is a deliberately **hybrid** architecture, not "the whole API is
CRDT-based":

- `users`, `bands`, `band_members`, `invites`, `attachments`, `user_prefs`
  stay plain Postgres rows accessed via a conventional REST API — they're
  either single-owner data (`user_prefs`) or low-contention/administrative
  (band membership, invites), where CRDT merge semantics buy nothing over
  a normal transaction.
- Only `band_docs` (the Yjs document holding `songs`, `setlists`, and each
  setlist's `items` array) is CRDT-backed, because that's the data multiple
  band members genuinely edit concurrently, including offline.

Order within a setlist uses a `Y.Array`, not a position/index field on each
item — concurrent inserts/reorders merge conflict-free through Yjs's own
array semantics, instead of needing custom conflict resolution for
clashing position numbers.

The server writes a `snapshot` (plain JSON, Zod-validated against
`@bandstand/core`'s schemas) to Postgres on every debounced Hocuspocus
store. That snapshot is derived, not authoritative — it exists for
full-text search, PDF export, and public links, which all want to query
structured data without decoding a Yjs document.

## Consequences

- Future contributors should not assume every table is Yjs-backed — most
  aren't. Check this ADR (or `docs/ARCHITECTURE.md`) before reaching for
  Yjs on a new feature; it's the right tool specifically for concurrent,
  offline-capable collaborative editing, not a default.
- Band-membership authorization on the Hocuspocus WebSocket connection is
  a known gap in Milestone 0 (checked via a valid session/JWT only, not
  "is this user actually in this band") — tracked as
  [bandstandhq/bandstand#1](https://github.com/bandstandhq/bandstand/issues/1),
  not silently shipped.
- The snapshot being derived-not-authoritative means a bug in
  `yDocToSnapshot` can produce a stale/wrong snapshot without corrupting
  the real data — recoverable by re-deriving from the Yjs state — but also
  means anything reading `snapshot` directly (search, exports) needs to
  tolerate it lagging slightly behind the live document during the
  debounce window.
