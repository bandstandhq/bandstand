# ADR-0008: A song's voices are typed by kind, and assignment is band-wide state

## Context

ADR-0004 deliberately shaped `voices` as its own Y.Map, keyed independently of `songs`, so that
"a song can have more than one voice" would be additive when it actually arrived — Milestone 1
just never created more than one. Milestone 2 is that arrival: horn/string/keyboard players read
written parts, not ChordPro, so a song now needs to carry both a ChordPro voice and one or more
scanned-PDF voices side by side, and every band member needs to land on *their own* voice for a
song without manually picking it every time.

Two things follow from that which ADR-0004 didn't have to decide yet:

1. A voice's *content* is no longer uniformly "a ChordPro string" — it's either that, or a
   sequence of files. Code that reads a voice needs to know which, not just assume `.body` exists.
2. "Which voice does this member play" is itself shared, collaborative state — not a personal
   preference like the existing per-user song notes (`user_prefs`). A trumpet player who joins the
   band shouldn't have to be told out-of-band which voice is theirs, and an admin arranging parts
   for a new member needs to be able to set it for them.

## Decision

### `voiceSchema` becomes a discriminated union on `kind`

`packages/core/src/schemas/voice.ts`: `kind: 'chordpro' | 'files'`. A `'chordpro'` voice keeps the
`body: string` field exactly as before; a `'files'` voice carries `files: FileRef[]` (min length
1) instead — see ADR-0007 for `FileRef`'s content-addressed shape. Both variants may carry an
optional `instrument` (e.g. `"Trumpet in B"`), used only for assignment guessing, below.

A voice written under Milestone 1 has no `kind` field at all. `voiceSchema` preprocesses a missing
`kind` to `'chordpro'` before validating against the union, so every existing voice keeps parsing
unchanged — this is additive, not a migration, exactly as ADR-0004 anticipated. Call sites that
read `voice.body` unconditionally (`StageMode.tsx`, `SongEditor.tsx`, `ExportRepertoire.tsx`) now
narrow on `voice.kind === 'chordpro'` first; a `'files'` voice falls through to a placeholder in
each until its own viewer exists (a later Milestone 2 step).

### Multiple voices per song are just multiple entries in the same map

Nothing about the `voices` Y.Map's shape changes — a song with three voices is three entries that
all share the same `songId`. `listVoicesForSong` (`packages/core/src/yjs/voices.ts`) is the one
place that scans for them; `createVoice` adds another voice to a song that already has one, at a
fresh id (`voice:<uuid>`), distinct from `getDefaultVoiceId`'s deterministic id for the original
voice.

### Assignment is a band-wide Y.Map, not per-user local state

A new top-level `assignments` Y.Map, key `<songId>:<userId>`, value a `voiceId`
(`packages/core/src/yjs/assignments.ts`). This is deliberately *not* modeled like the existing
per-user `user_prefs` (personal notes, personal transpose) — those are private to one person and
live in Postgres; an assignment is visible to and meaningful for the whole band (the point is that
everyone can see who plays what), so it belongs in the shared Yjs document like `songs`/`voices`
themselves.

`getAssignedVoiceId(doc, songId, userId, memberInstrument?)` resolves, in order: an explicit
assignment, else the first voice for the song whose `instrument` matches the member's own, else
the song's first voice by insertion order (which is always the original ChordPro voice for any
song that predates this feature). This mirrors `getDefaultVoiceId`'s old role as "the one voice a
member sees," without hardcoding that there's only one.

### Changing your own assignment needs no permission check; changing someone else's does

`selfPrefs:edit` already established the pattern that self-scoped state isn't a matrix row — a
member may always change their own instruments/notes/transpose. Assignment follows the same
logic: `can(role, 'assignment:editOthers')` (admin minimum) gates only the "change *another*
member's* assignment" affordance; there is no separate row for "change your own," because it's
unconditionally allowed at every role. See `packages/core/src/permissions/matrix.ts`.

## Consequences

- `bandSnapshotSchema` gains `assignments` (defaulting to `{}` for any doc written before this
  change), alongside `songs`/`voices`/`setlists` — same additive treatment as ADR-0004 gave
  `voices` itself.
- A voice's `files` array is edited via ordinary CRDT for additions (`file:upload` is
  member-level, matching `song:create`), but removing a file (`file:detach`) goes through REST +
  `withBandDoc`, matching `song:deleteForever` — see ADR-0007's consequences for why that one
  action doesn't extend the manipulated-client CRDT guard.
- `StageMode`'s Follow Mode (ADR-0004's `StagePosition`) still assumes a single voice's content
  per member for now; reconciling a shared stage position across members who are on *different*
  voices for the same song is explicitly out of scope here and remains Milestone 2 Part B's
  problem, not this ADR's.
