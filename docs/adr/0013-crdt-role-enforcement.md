# ADR-0013: Admin-only calendar/anchor/assignment actions get their own CRDT-layer guards

## Context

The permissions matrix (`packages/core/src/permissions/matrix.ts`) declares `event:create`,
`event:edit`, `event:delete`, `poll:create`, `anchor:edit`, and `assignment:editOthers` as
admin-only. None of these have a REST route in front of the actual write — creating/editing an
event or poll, editing a song's anchor list, and overriding another member's voice assignment are
all plain, real-time collaborative Yjs edits, the same shape as editing a song's title. ADR-0011
already established this pattern for `availability`/`pollVotes` (self-scoped, enforced by an
ownership guard in `hocuspocus.ts`'s `onChange` hook) and stated, incorrectly, that nothing else in
that area needed a server-side guarantee beyond it. It does: `onAuthenticate` only checks band
membership, not role, so a plain member's raw WebSocket connection could create/edit any event or
poll, edit any song's anchors, or overwrite anyone's voice assignment — the web UI hiding those
controls for non-admins was the only thing standing in the way.

## Decision

Three new guard predicates in `hocuspocus.ts`'s `onChange` hook, alongside the two ADR-0005/
ADR-0011 already added — each guards a genuinely different shape of exception, so each gets its
own predicate rather than being forced into an existing one (per ADR-0011's own closing note):

- **Pure role guard** (`ROLE_GUARDED_MAPS = ['events', 'polls']`): any touched top-level key —
  inserted, changed, or deleted — from a non-admin actor is reverted. No self-scope exists here at
  all, unlike availability/pollVotes.
- **Pure role guard over a dynamic array** (`anchors:<songId>` for every songId currently in
  `songs`): anchors are band-wide, not per-member (matrix.ts's own comment), so a non-admin's edit
  to any song's anchor array is reverted wholesale — the same whole-array-rewrite approach
  `reorderAnchors` itself already uses, not a fine-grained per-element diff.
- **Self-or-admin guard** (`SELF_OR_ADMIN_GUARDED_MAPS = ['assignments']`): a member changing
  *their own* assignment (`${songId}:${userId}` matching their own id) is always allowed at any
  role; overriding someone else's needs admin. This is the one guarded map where two exceptions
  apply to the same predicate.

One correctness detail worth stating explicitly, since it's easy to get wrong by copying the
existing ownership guard's shape: the ownership guard's `before[key] === after[key]` reference
check is only safe because `availability`/`pollVotes` store plain strings. `events`, `polls`,
`assignments`, and anchor arrays store objects/arrays, and `Y.Map.toJSON()`/`Y.Array.toJSON()`
build a fresh plain value on every call — two structurally-identical snapshots are never `===`.
The three new predicates compare by content (`JSON.stringify`) instead, or they'd revert every
touched key on every write regardless of whether anything actually changed.

## Consequences

- `hocuspocus.ts`'s `onChange` hook now has five independent guard predicates instead of two. A
  sixth kind of guarded shape in the future should get its own, not be forced to fit one of these
  five.
- Proven the same way every prior guard in this hook was: a real member connection, over a live
  WebSocket, with no REST call involved, attempting the exact bypass — see
  `hocuspocus.integration.test.ts`'s three new tests.
- ADR-0011's claim that events/polls need nothing beyond the existing ownership guard was wrong;
  this ADR is the correction, not an amendment to a decision that turns out to have been
  incomplete by design.
