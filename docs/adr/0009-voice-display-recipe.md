# ADR-0009: A voice's display customization is a recipe, applied at render time, never a file edit

## Context

A3.1 gave every `files`-kind voice a real pdf.js viewer. Real-world scans need more than plain
page-by-page display: a crooked scan needs rotating, a scan with wide margins needs cropping so
the actual notation fills the screen, and a scan that's split unnaturally across sheets sometimes
needs its pages reordered. None of this should touch the uploaded file itself — the file is
content-addressed (ADR-0007) and may be shared by other bands/voices that never asked for this
particular musician's crop or rotation; mutating it would silently change what a *different* voice
displays too, or defeat the point of content-addressing (dedup would stop matching a corrected
scan against ones already uploaded elsewhere).

## Decision

A `files`-kind voice gets an optional `displayRecipe` (`packages/core/src/schemas/voice.ts`):

- `cropMargins?: {top, right, bottom, left}` — fractions of page width/height, applied to every
  page in the voice uniformly. Not per-page: a scanning session's margins are typically consistent
  across every page it produced, and per-page crop state would be a lot of UI for a case that
  rarely comes up. Rotation gets the opposite treatment (below) precisely because "one page scanned
  sideways in an otherwise-straight batch" is the common real case, unlike per-page margins.
- `rotations?: Record<originalPageIndex, 0 | 90 | 180 | 270>` — per page, keyed by the page's
  position in the flat sequence built by concatenating the voice's `files` in order (page 0 = the
  first page of the first file). This identity is stable regardless of how the recipe later
  reorders or duplicates pages for *display*.
- `pageOrder?: number[]` — the actual rendered sequence, as a list of those same original indices.
  Reordering is a permutation of this array; duplicating a page is that index appearing twice.
  There is deliberately no separate "duplicated pages" list: `pageOrder` alone is a complete,
  unambiguous description of the sequence, so a second field could only ever restate or
  contradict it. Each occurrence still gets its own position in the resolved sequence
  (`resolveDisplaySequence`'s `position` field), which is what will let Teil B attach an
  annotation to *one* occurrence of a duplicated page without it appearing on the other.
- No recipe at all (every voice before this change, and any newly created one) means natural file
  order and no rotation — resolved identically to an explicit `{pageOrder: [0,1,2,...]}`.

`resolveDisplaySequence(files, displayRecipe)` (`packages/core/src/yjs/voices.ts`) is the one
place this gets computed, so the viewer and any future consumer (export, printing) share the same
logic rather than each re-implementing "what page goes where." It's pure and DOM-free, so it's
unit-tested directly — the actual pixel-level crop/rotate happens in `PdfVoiceViewer.tsx`, which
renders each page to an offscreen canvas at full resolution, then draws the cropped/rotated region
into the visible canvas; the source file bytes are never touched.

## Consequences

- `detachVoiceFile` (removing a file from a voice) now clears the voice's `displayRecipe`
  entirely rather than trying to shift its indices. A recipe's page indices are positions in the
  *current* `files` array; removing one file shifts every later page's index, and silently
  re-pointing rotations/pageOrder at the wrong pages would be worse than asking the user to
  re-crop/re-rotate. `file:detach` is already an infrequent, admin-only action (ADR-0007), so this
  tradeoff is cheap.
- A duplicated page is a real, distinct entry in the resolved sequence (its own `position`), not a
  rendering trick layered over a single canvas — Teil B's "attach an annotation to one occurrence"
  requirement is already satisfiable with this shape, without another schema change.
- Crop/rotate/reorder edits are ordinary CRDT writes to the voice (`setVoiceDisplayRecipe`), same
  permission tier as any other voice edit (`file:upload`-level, i.e. any member) — this is
  personalization of *how a shared file displays*, not a destructive action on shared data, so it
  doesn't need the REST+guard treatment `file:detach`/`song:deleteForever` get.
