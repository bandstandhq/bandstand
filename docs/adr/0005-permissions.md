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

### Deleting a band archives it first; only development/test data skips the grace period

`band:delete`'s underlying action changed from an immediate hard delete to archiving
(`bands.archivedAt`, set rather than the row being removed): the owner has 30 days
(`packages/core/src/bands/archive.ts`'s `ARCHIVE_GRACE_PERIOD_MS`) to restore it (`POST
/bands/:bandId/restore`, also owner-only) before `apps/server/src/bands/sweepArchived.ts` — a
cron-triggered script, the same "manual/scheduled tool, not an automatic in-process job" shape as
`push/due.ts` — permanently deletes it. An archived band is excluded from `GET /bands` (so it
disappears from the switcher and dashboard exactly as a hard delete would) but surfaced again via
a separate, owner-scoped `GET /bands/archived`, and its Hocuspocus connections are closed
immediately at archive time, same as the old hard-delete path.

This 30-day safety net exists to protect a real band's real data from an accidental or
impulsive deletion — it is deliberately skipped (immediate hard delete, exactly the pre-existing
behavior) whenever the band is plainly not that: its slug starts with `test-` (the repo-wide
"this row belongs to a test run" convention — see `CONTRIBUTING.md` and
`cleanupTestAccounts.ts`), or the server isn't running with `NODE_ENV=production`. A self-hosted
development instance and an automated test suite both need deletion to actually take effect
immediately, not leave a 30-day trail of archived rows nothing ever sweeps up on purpose.

### Leaving as owner transfers ownership automatically, rather than being blocked

The precondition described below (Consequences) as "the owner must transfer ownership first" has
been replaced: `DELETE /bands/:bandId/members/me` now computes a successor itself
(`apps/server/src/lib/ownershipSuccession.ts`) — the highest-ranked remaining member (admin over
member), ties broken by whoever joined the band earliest (`bandMembers.joinedAt`, already used
for `GET /bands`' own ordering) — and, in one transaction, removes the leaving owner and promotes
that successor, rather than rejecting the request outright. `GET /bands/:bandId/members/successor`
(owner-only) lets the web UI name the successor in a confirmation dialog *before* the owner
commits to leaving; the `DELETE` handler re-runs the same query at commit time rather than trusting
whatever the preview call returned, since membership can change between the two requests. Only a
sole remaining owner — no one else in the band to hand it to — is still rejected (`409
owner_must_transfer_first`), the one case auto-succession has no answer for.

The leaving owner's row is deleted *before* the successor's role flips to `'owner'`, not after:
`band_members_one_owner_idx` (the partial unique index backstopping "exactly one owner") is a
plain, non-deferred index, checked per statement — updating the successor first would momentarily
describe two owner rows in the same band and fail the same way a bug in `transfer-ownership`'s own
two-update ordering would.

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
- `band:leave`'s owner case is a precondition (and, now, an automatic ownership transfer) inside
  the leave-band route handler, not a matrix cell — `can(role, 'band:leave')` is `true` for every
  role, by design, since the restriction is about band *state* (is there anyone left to become
  owner), not about the caller's *role*.
- A DB-level partial unique index (`band_members` — at most one `role = 'owner'` row per band,
  added alongside the ownership-transfer endpoint) backstops "a band always has exactly one owner"
  independently of any application-level logic getting that transaction wrong.
