# ADR-0006: Offline cache scoping and membership gating

## Context

Milestone 1's Stage Mode acceptance testing (see the milestone plan's Step 6.1) turned up a real
gap while writing the "non-member document access denied" scenario: Hocuspocus's `onAuthenticate`
already rejected a non-member's WebSocket connection correctly (closes
[#1](https://github.com/bandstandhq/bandstand/issues/1)), but the web app still displayed the
band's full content — every song, lyrics included — to that non-member, because `connectBandDoc`
(`apps/web/src/lib/yjs.ts`) keyed the local `y-indexeddb` cache purely by `bandId`. IndexedDB is
scoped to the browser origin, not to the logged-in user, so any device that had ever loaded that
band's data (a rehearsal-room laptop, a shared family computer, a removed member's old browser
profile) went on serving that cached content to whoever next opened the app there, regardless of
their actual, current membership. The WebSocket rejection happened in parallel, but by then the
cache had already rendered.

This is a real privacy gap, not a hypothetical one: band content (setlists, ChordPro lyrics/chords,
band notes) isn't public, and "reject the live connection" is not the same guarantee as "never show
this device the data."

## Decision

### The cache is keyed by user and band, not band alone

`bandIndexedDbName(userId, bandId)` produces `bandstand:<userId>:<bandId>`. Two different accounts
on the same device get two independent caches; one account never reads another's. Logging out
deliberately does **not** clear this cache — the whole point of `y-indexeddb` is that the *same*
user can keep working offline after a logout/login cycle (e.g. a session expiring mid-flight) or a
browser restart. Only two things actually delete a cache:

1. A confirmed "not a member" answer (below), scoped to exactly that `userId:bandId` pair.
2. An explicit "Delete local data" action in the Dashboard, which the user reaches for deliberately
   (e.g. before handing off a shared device), covering every band's cache for their own account.

### A rejection with an explicit reason, not an inferred one

`apps/server/src/lib/hocuspocus.ts`'s `onAuthenticate` throws an error carrying a `.reason` field —
`@hocuspocus/server` forwards this to the client as an application-level "permission denied"
message (`provider.on('authenticationFailed', ({ reason }) => ...)`), not a WebSocket close code.
The reason is one of `HOCUSPOCUS_AUTH_FAILURE_REASON` (`packages/core/src/hocuspocus/authFailure.ts`):
`'unauthorized'` (no valid session — not a membership judgement) or `'not-a-member'` (a valid
session that just isn't a member of this band). Only `'not-a-member'` triggers a cache wipe
(`useBandDoc`'s `deny()`) — a network hiccup, a server restart, or an expired-but-otherwise-fine
session must never be treated as grounds to delete someone's offline data. Using the reason string
already built into the protocol, instead of trying to infer intent from a close code, means this
distinction can never become ambiguous as a side effect of an unrelated Hocuspocus upgrade.

### A REST membership check gates the cache before anything renders

`useBandDoc` calls `apiClient.checkBandMembership` (a thin wrapper around the already-existing,
already-authorized `GET /bands/:bandId/members`) once per mount, before exposing `doc`/`provider`
to the calling page at all. Only a `'member'` result (or, offline, a previously-recorded
`'member'` result — see below) reveals the cache; a `'not-member'` result denies immediately,
without waiting for the slower WebSocket round-trip. This catches the exact non-member-loads-a-
cached-band scenario the acceptance test targets, on the very first render, not just eventually
once Hocuspocus gets around to rejecting the connection.

### Offline: trust the last confirmed membership

A REST check can fail for reasons that have nothing to do with membership — no network at all,
mid-song on stage. If the check is inconclusive, `useBandDoc` falls back to a small
`localStorage` record of the last *confirmed* membership for that `userId:bandId` pair (written
whenever a check or a live sync succeeds, cleared whenever one explicitly fails). Defaulting to
"deny" whenever a check is inconclusive would make Stage Mode unusable exactly when it matters
most — a venue with no signal — so the offline fallback deliberately trusts stale-but-once-true
information here, the same tradeoff every other offline-first layer in this app already makes.

## Consequences

- **The remaining limit is real and is not fixed by anything above, because it can't be**: anyone
  with physical access to a device that stays offline retains whatever was last synced to it, for
  as long as it stays offline. Reconnecting is what triggers the membership re-check that would
  revoke access — a device kept offline on purpose never reconnects, so it never re-checks. This
  is not specific to Bandstand's architecture; it is true of every offline-first application that
  keeps a local copy of data for use without a network (email clients, note-taking apps, and any
  other CRDT-based tool included). It is documented here rather than "fixed" because the fix would
  be "don't support offline use," which defeats the brief's core requirement.
- Every page that calls `useBandDoc` (`Dashboard`, `Repertoire`, `SetlistList`, `SetlistDetail`,
  `SongEditor`, `StageMode`) must check its `status` for `'forbidden'` and render
  `<BandAccessDenied />` instead of any content derived from `doc` — this isn't optional per-page
  polish, it's the actual security boundary. A future page that reads `useBandDoc` and skips this
  check reopens exactly the gap this ADR closes.
- `checkBandMembership` deliberately reuses `GET /bands/:bandId/members` (already gated by
  `requireBandRole('member')`) as a membership oracle rather than adding a dedicated endpoint —
  the 200/403 split it already returns is exactly the answer needed.
- The two acceptance tests this gap produced
  (`apps/web/e2e-acceptance/non-member-access.spec.ts`,
  `apps/web/e2e-acceptance/removed-member.spec.ts`) were confirmed failing against the pre-fix code
  before this change landed, and now pass against it.
