# ADR-0004: Song content lives on a voice ("parts"); Stage position is logical, not visual ("anchors")

## Context

Two related pieces of future work are visible from the brief even though neither is fully built
yet:

1. **Multiple parts per song.** Eventually, different musicians in the same band will want their
   own version of a song's text — a bass player's chart isn't a singer's lyric sheet. If a song's
   ChordPro content is a field directly on the song, "give this song a second version" means
   restructuring the data model later, migrating every existing song, and touching every place
   that reads `song.body`.
2. **Anchoring Stage Mode's shared position across different content per musician.** Once part (1)
   exists, band members following each other in Stage Mode may be looking at *different* text for
   the same song (different length, different line breaks). A shared position expressed as "line
   14" or "62% scrolled" stops meaning the same thing to two people looking at different content.
   The position broadcast over Awareness needs to be a concept that survives that — a musical
   anchor ("second chorus", "bar 32"), not a rendering coordinate.

Both are "not yet" in Milestone 1 — there's exactly one voice per song, and Stage Mode's Follow
Mode only needs to work when everyone is looking at the same content — but both are shaped by this
same idea: **don't tie collaborative state to the current single-representation assumption**, since
undoing that later means a real data migration and a broadcast-format break, not a refactor.

## Decision

### Parts: a `voices` Y.Map, not a `body` field on `Song`

`songSchema` (`packages/core/src/schemas/song.ts`) carries no ChordPro content and no reference to
exactly one text representation. A new `voiceSchema` (`packages/core/src/schemas/voice.ts`) holds
`{ songId, name, body }`, stored in its own `voices` Y.Map alongside `songs` and `setlists` in the
per-band Yjs document (see `docs/ARCHITECTURE.md`).

Milestone 1 always creates exactly one voice per song, at the deterministic id
`getDefaultVoiceId(songId)` (`voice:<songId>`) — a direct-lookup convenience for the current
one-voice-per-song reality, not a modeling assumption. When multiple voices per song actually
arrive, that helper's callers become "pick from the song's voices" instead of a fixed id, and nothing
about the schema itself has to change.

### Anchors: Stage position is a logical value, not a scroll coordinate

The Awareness payload broadcast during Stage Mode (see `docs/ARCHITECTURE.md`'s "Stage" layer)
carries a `StagePosition` — introduced as its own named type in `packages/core` when Stage Mode is
built, not an inline shape on the Awareness payload. In Milestone 1, with a single voice per song,
`StagePosition` is `{ sectionIndex, fraction }` (which ChordPro section, and how far through it) —
already one step more durable than a raw scroll percentage, since it survives font-size and
display-mode changes. When multiple voices per song exist, the same type extends to identify a
musical anchor point shared across differently-lengthed content (e.g. "start of second chorus")
instead of a position within one specific text. Call sites that read a `StagePosition` don't need
to change when that happens — only its internal shape does.

## Consequences

- Milestone 1's Repertoire work (song editor, ChordPro import/export) reads and writes through a
  song's default voice, not a `song.body` field — there isn't one.
- `yDocToSnapshot`/`snapshotToYDoc` (`packages/core/src/yjs/snapshot.ts`) and `bandSnapshotSchema`
  carry `voices` as a top-level map, same shape/status as `songs`/`setlists`.
- This is a breaking change to Milestone 0's Yjs document shape. No migration script was written
  because there's no real production data yet — only seed/dev data, updated in the same change
  (`apps/server/src/seed/songs.ts`/`seed/index.ts`).
- A future "multiple voices per song" feature is additive to this shape (more entries in `voices`,
  a real voice-picker instead of `getDefaultVoiceId`), not a schema migration.
- Stage Mode's Follow Mode, once built, must key off `StagePosition`, never off scroll pixels or
  raw percentage — that's the whole point of introducing the type now, before Stage Mode UI exists,
  so nothing gets built against a coordinate system that has to be thrown away later.
