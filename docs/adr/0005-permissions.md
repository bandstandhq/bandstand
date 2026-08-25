# ADR-0005: A single permissions matrix, enforced at the boundary the data actually lives behind

## Context

Milestone 1 shipped `requireBandRole(minRole)` for REST routes and an ad hoc `isAdmin` computation
copy-pasted into `BandSettings.tsx` and `Repertoire.tsx` for the UI. Neither was wrong for what it
covered, but neither was a *matrix* — there was no single place answering "can this role do this
specific thing," so adding a new gated action meant re-deriving the right rank threshold from
scratch, in prose, in whichever file needed it next.

Manual testing before release surfaced the sharper problem this created: several actions the brief
calls out as restricted (permanently deleting a song, deleting a setlist) mutate data that lives in
the shared per-band Yjs document (`docs/adr/0002-crdt-over-rest.md`). Every band member's browser
already holds a live, writable connection to that document for entirely legitimate reasons — normal
song/setlist editing is unrestricted CRDT by design. `onAuthenticate` gates *who can connect at
all*, but says nothing about what a connected member's client is allowed to write once connected.
A UI that simply hides a "delete forever" button is not an access control — a modified or scripted
client can call the same underlying Yjs mutation directly.

## Decision

### One matrix, one function, two call sites

`packages/core/src/permissions/matrix.ts` exports `can(role: BandRole, action: Action): boolean`
and `canRemoveMember(actorRole, targetRole): boolean`, built on `hasAtLeastRole`
(`packages/core/src/permissions/roles.ts`, moved out of `apps/server/src/lib/bandAuthz.ts` so the
rank ladder itself isn't duplicated either). `docs/PERMISSIONS.md` is the human-readable rendering
of the exact same table `MIN_ROLE` encodes — not a second copy that can drift from it.

`apps/server` calls `can()`/`canRemoveMember()` inside route handlers as the actual authorization
decision. `apps/web` calls the identical functions to decide what to render. Neither reimplements
the matrix in its own words; both consult the one in `packages/core`.

### Two kinds of destructive action, enforced differently

- **Postgres-only actions** (`band:delete`, `member:changeRole`, `member:remove`,
  `band:transferOwnership`, invite management) have no Yjs-doc bypass vector at all — band
  membership and invites live only in Postgres, which a client can only ever reach through REST.
  A `requireBandRole('member')` baseline (confirms the caller is at least a band member; every
  band-scoped route keeps using it) plus an inline `can()`/`canRemoveMember()` check is the entire
  enforcement story for these.
- **Yjs-doc actions restricted below `member`** (`song:deleteForever`, `setlist:delete`) need more:
  the REST handler applies the change via `Hocuspocus.openDirectConnection` (`apps/server/src/lib/
  bandDoc.ts`'s `withBandDoc`), and a narrow `onChange` guard in `apps/server/src/lib/hocuspocus.ts`
  actively reverts an unauthorized removal of a `songs`/`setlists` map key coming from a real client
  connection, distinguishing it from the server's own direct-connection writes via Hocuspocus's
  `transactionOrigin` discriminator (`{source: 'connection'}` vs. `{source: 'local'}`). This is a
  real enforcement boundary, not UI-only: a manipulated client that deletes the map entry directly
  has its change reverted server-side, logged with the acting user id, band id, and the restored
  key (see Consequences — the log is deliberate, not a silent fix).

### `idea:resolveTie` is a workflow, not a new boundary

`idea:resolveTie`'s underlying mutation is exactly `setSongStatus` — the same function
`song:archive`/`song:restore` already call, and every role from `member` up already has
unrestricted rights to call it. Routing tie-resolution through a REST endpoint gives it a
reviewed, attributable path and lets the UI only offer it once a vote is genuinely tied, but it
does not and cannot close an access-control gap, because there was never a gap here to close — a
member could always archive or restore a song outright. This ADR states that plainly rather than
building (or implying) a guard that wouldn't guard anything a member doesn't already have the
right to do.

## Consequences

- Adding a new gated action means adding one entry to `MIN_ROLE` (and, for a Yjs-doc action, adding
  the corresponding map to the `onChange` guard's watch list) — never re-deriving a threshold by
  hand at each call site.
- The `onChange` guard's revert is intentionally visible, not silent: a client attempting this is
  either buggy or malicious, and either way that needs to be seen, not just quietly corrected. The
  current implementation only logs; a follow-up issue tracks surfacing this as a visible admin-facing
  warning in the band UI once it fires (referenced at the guard's call site).
- The guard's scope is deliberately narrow — only whole-key removal on the `songs` and `setlists`
  maps. Item-level setlist edits (reordering, adding, removing individual items) stay ordinary,
  unguarded CRDT, exactly as the matrix already allows for every role; guarding them would be
  restricting an action nothing in the matrix restricts.
- `band:leave`'s "owner must transfer ownership first" rule is enforced as a precondition inside
  the leave-band route handler, not as a matrix cell — `can(role, 'band:leave')` is `true` for
  every role, by design, since the restriction is about band *state* (is there another owner yet),
  not about the caller's *role*.
- A DB-level partial unique index (`band_members` — at most one `role = 'owner'` row per band,
  added alongside the ownership-transfer endpoint) backstops "a band always has exactly one owner"
  independently of any application-level logic getting that transaction wrong.
