# ADR-0010: Stage Mode syncs on musical anchors, with a four-level fallback ladder

## Context

ADR-0004 anticipated this moment: `StagePosition` was deliberately introduced as `{sectionIndex,
fraction}` — one step more durable than a raw scroll percentage — specifically so it could later
become a real musical anchor without changing any of its callers, only its internal shape. Teil A
made that necessary: a song can now have several voices of genuinely different kinds (a singer's
ChordPro lyrics, a horn player's scanned PDF part), different lengths, and different page counts.
"Scroll fraction of the whole item" stopped meaning the same thing to two people looking at
different content the moment that became possible.

The brief's own framing was blunt about the alternative: never assume perfect sync is available,
and never let a musician face a blocked or broken view because of it. A shared position is a nice
extra, not something the show depends on.

## Decision

### Anchors are the shared vocabulary, not a per-voice concept

A song's `anchors` (`packages/core/src/schemas/anchor.ts`: `{id, label, order, bar?, timeMs?}`) are
band-wide and owner/admin-authored — "Intro", "Chorus", "Letter B", "Bar 33". They are the thing
every voice's own position maps *into*, never duplicated per voice. A `chordpro` voice needs no
calibration at all: its render model's section labels are matched against anchor labels at read
time (`matchAnchorsToChordProSections`), so authoring a ChordPro section as `{start_of_chorus:
label="Chorus"}` is already enough. A `files` voice stores an explicit `anchorMap` (manual
tap-to-set, or a Lernmodus proposal — see below); a missing entry for either voice kind is
expressly allowed, not an error.

### `StagePosition` becomes `{anchorId, fraction}`

`fraction` is progress from that anchor toward the *next known* one (`order`-wise), not a
percentage of the whole song. For a `files` voice this is a real interpolation between two
calibrated page positions, never a hardcoded `0` — a ChordPro listener following a horn player
needs to see movement within a section, not a jump that never advances once it lands.
`StageAwarenessState.position` is optional: it's absent entirely at the lower two fallback levels
below, rather than holding a value that would be misleading.

### The Awareness wire format never grows a second, page-shaped field

The fallback ladder's second rung ("no anchors, but everyone's on the identical file") still needs
to say *something* logical about position — a page number is exactly that kind of value, the same
way `sectionIndex` was before this ADR. Rather than add a second field for it, a page number is
sent *as* an anchor id: a synthetic `page:<n>` pseudo-anchor (`computePageSyncPosition`/
`applyPageSyncPosition`, `packages/core/src/yjs/stageSync.ts`), agreed by convention between
clients that have already confirmed they share the same file. The wire schema is therefore always
exactly one shape — `position: {anchorId, fraction} | undefined` — never a raw page number or
scroll pixel under any other name, checked structurally (the schema's own key set, not a runtime
guess) rather than assumed.

### The four-level fallback ladder is mandatory, checked live, never blocking

| Situation | What syncs |
|---|---|
| The song has anchors | Song and anchor position |
| No anchors, every present voice is the identical file | Song and page (via the pseudo-anchor above) |
| No anchors, voices differ | Song only |
| No network | Nothing — everyone stays fully playable locally |

`determineSyncLevel` (`packages/core/src/yjs/stageSync.ts`) computes this from the song's anchors,
every currently-present member's resolved voice (on the same setlist item), and the connection
status — purely informational, shown as a small indicator in Stage Mode's header. It never gates
whether Follow Mode is *attempted*; it only describes what it can currently promise. A peer with no
`position` at all (levels 3–4) still has their *item* mirrored — the one thing every level
guarantees — just not a within-item position; everyone scrolls or pages for themselves at that
point, exactly as if Follow Mode weren't running.

### An unknown anchor walks back, silently

A device that receives an anchor id its own voice has no mapping for — a page arrived that hasn't
been calibrated yet, or a chordpro voice with no matching section — resolves to the nearest earlier
anchor (by `order`) it *does* know (`resolveKnownAnchor`), and shows a dismissible, non-blocking
hint. Never an error, never a dialog: the device that's behind on calibration shouldn't be the one
that breaks the show for whoever's following it.

### Lernmodus proposes, never applies

A leader can announce anchors by tapping through them during a rehearsal — literally the same
broadcast a real performance would send, just driven by an explicit click instead of a derived
scroll position. Anyone else, on their own `files` voice, keeps turning pages normally; the app
notes which page was open each time a new anchor arrived, and presents each `{anchor → page}`
pairing as an individual, confirm-or-discard proposal. This is the only way a `files` voice's
`anchorMap` gets populated other than a manual tap — and even here, nothing is written until a
person says so.

## Consequences

- Every existing caller of `StagePosition` had to change with the type — `StageMode.tsx`'s
  broadcast/receive/follow logic, `createInitialStagePosition`, and the ChordPro section-tracking
  itself, which moved from a hardcoded `sectionIndex: 0` to real DOM measurement
  (`data-anchor-section-index` attributes + scroll-offset comparison), since there was finally a
  reason for it to matter.
- A `files` voice's Follow Mode application is a full page jump (`PdfVoiceViewer`'s
  `jumpToRenderedPosition`), never a sub-page scroll — a calibrated point is already the most
  specific position available for a paginated document, so there's no finer position within an
  anchor's span worth building for that voice kind.
- The page-sync pseudo-anchor is deliberately ephemeral and local to the broadcasting/receiving
  pair — it is never written into a song's real `anchors` list, and carries no meaning once anyone
  present is on a different file.
- A song with zero anchors and entirely different voices per member — a plausible state right after
  Teil A, before anyone has set up Teil B's anchors yet — degrades to "song only" automatically,
  with no migration and no broken state; the ladder was built to make that the *expected* starting
  point, not an edge case.
