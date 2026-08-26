// SPDX-License-Identifier: Apache-2.0
//
// Position <-> anchor conversion for Stage Mode's Follow Mode — the payoff
// of ADR-0004 and the core of docs/adr/0010-anchor-sync.md's design. Kept
// separate from yjs/anchors.ts and yjs/voices.ts (which this imports from)
// to avoid a circular import between those two.
import type { Anchor } from '../schemas/anchor';
import type { DisplayRecipe, VoiceAnchorPosition } from '../schemas/voice';
import type { StagePosition } from '../schemas/stagePosition';
import type { FileRef } from '../files/schema';
import { matchAnchorsToChordProSections } from './anchors';
import { flattenVoiceFiles, findRenderedPositionForSourcePage, type ResolvedPage } from './voices';

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function byOrder(anchors: Anchor[]): Anchor[] {
  return [...anchors].sort((a, b) => a.order - b.order);
}

/**
 * Walks the song's anchors (in `order`) for the last one at or before
 * `scalarFor(anchor)`, pairing it with the next one that has a value, so
 * callers can interpolate `fraction` as progress across that span. Shared
 * between the ChordPro and files paths below — only what "scalar" means
 * differs (a section index vs. a flattened page+yPct value).
 */
function findCurrentAndNext(
  orderedAnchors: Anchor[],
  scalarFor: (anchor: Anchor) => number | undefined,
  currentScalar: number,
): { current: { anchor: Anchor; scalar: number }; next: { anchor: Anchor; scalar: number } | undefined } | undefined {
  const withScalars = orderedAnchors
    .map((anchor) => {
      const scalar = scalarFor(anchor);
      return scalar === undefined ? undefined : { anchor, scalar };
    })
    .filter((x): x is { anchor: Anchor; scalar: number } => x !== undefined);

  let currentIndex = -1;
  withScalars.forEach((entry, i) => {
    if (entry.scalar <= currentScalar) currentIndex = i;
  });
  if (currentIndex === -1) return undefined;

  return { current: withScalars[currentIndex]!, next: withScalars[currentIndex + 1] };
}

export interface ChordProViewState {
  sectionIndex: number;
  /** How far through that section, 0-1 — from scroll position, not stored. */
  fractionInSection: number;
}

/**
 * The device's current position in a ChordPro voice, expressed as the
 * nearest matched anchor at or before it plus progress toward the next
 * matched one. `undefined` when the view is before any matched anchor —
 * there's genuinely no "current anchor" yet, not a value worth guessing.
 */
export function computeCurrentAnchorInChordPro(
  anchors: Anchor[],
  sections: { label: string | null }[],
  viewState: ChordProViewState,
): StagePosition | undefined {
  const orderedAnchors = byOrder(anchors);
  const matched = matchAnchorsToChordProSections(orderedAnchors, sections);
  const currentScalar = viewState.sectionIndex + clamp01(viewState.fractionInSection);

  const found = findCurrentAndNext(orderedAnchors, (a) => matched.get(a.id), currentScalar);
  if (!found) return undefined;

  if (!found.next) return { anchorId: found.current.anchor.id, fraction: 0 };
  const span = found.next.scalar - found.current.scalar;
  const fraction = span > 0 ? clamp01((currentScalar - found.current.scalar) / span) : 0;
  return { anchorId: found.current.anchor.id, fraction };
}

/**
 * Inverse of the above: resolves an anchor + fraction to a
 * `{sectionIndex, fraction}` to scroll a ChordPro voice to. `undefined` if
 * this voice's ChordPro content has no section matching the anchor's label
 * at all (the unknown-anchor case — callers fall back via
 * `resolveKnownAnchor` before calling this).
 */
export function applyAnchorToChordProPosition(
  anchors: Anchor[],
  sections: { label: string | null }[],
  anchorId: string,
  fraction: number,
): ChordProViewState | undefined {
  const orderedAnchors = byOrder(anchors);
  const matched = matchAnchorsToChordProSections(orderedAnchors, sections);
  const sectionIndex = matched.get(anchorId);
  if (sectionIndex === undefined) return undefined;

  const anchorIndex = orderedAnchors.findIndex((a) => a.id === anchorId);
  let nextSectionIndex: number | undefined;
  for (let i = anchorIndex + 1; i < orderedAnchors.length; i++) {
    const candidate = matched.get(orderedAnchors[i]!.id);
    if (candidate !== undefined) {
      nextSectionIndex = candidate;
      break;
    }
  }

  if (nextSectionIndex === undefined) return { sectionIndex, fractionInSection: 0 };
  const scalar = sectionIndex + clamp01(fraction) * (nextSectionIndex - sectionIndex);
  return { sectionIndex: Math.floor(scalar), fractionInSection: scalar - Math.floor(scalar) };
}

/** originalIndex (from flattenVoiceFiles) + yPct as one continuous scalar — decision 6 in the Teil B plan. */
function filesScalar(files: FileRef[], fileIndex: number, page: number, yPct: number): number {
  const flat = flattenVoiceFiles(files).find((p) => p.fileIndex === fileIndex && p.pageNumberInFile === page);
  return (flat?.originalIndex ?? 0) + clamp01(yPct);
}

export interface FilesViewState {
  fileIndex: number;
  page: number;
  yPct: number;
}

/**
 * The device's current position in a `files` voice, via its `anchorMap`.
 * `fraction` is real interpolated progress toward the next calibrated
 * anchor (never a hardcoded 0) — a ChordPro follower tracking a horn
 * player needs to see movement within a section, not a jump that never
 * advances. `undefined` if nothing is calibrated at or before this page.
 */
export function computeCurrentAnchorInFiles(
  anchors: Anchor[],
  files: FileRef[],
  anchorMap: Record<string, VoiceAnchorPosition> | undefined,
  viewState: FilesViewState,
): StagePosition | undefined {
  if (!anchorMap) return undefined;
  const orderedAnchors = byOrder(anchors);
  const currentScalar = filesScalar(files, viewState.fileIndex, viewState.page, viewState.yPct);

  const found = findCurrentAndNext(
    orderedAnchors,
    (a) => {
      const pos = anchorMap[a.id];
      return pos ? filesScalar(files, pos.fileIndex, pos.page, pos.yPct) : undefined;
    },
    currentScalar,
  );
  if (!found) return undefined;

  if (!found.next) return { anchorId: found.current.anchor.id, fraction: 0 };
  const span = found.next.scalar - found.current.scalar;
  const fraction = span > 0 ? clamp01((currentScalar - found.current.scalar) / span) : 0;
  return { anchorId: found.current.anchor.id, fraction };
}

/**
 * Inverse: resolves an anchor to wherever it's currently rendered in a
 * `files` voice. `fraction` is deliberately ignored on receipt — a
 * calibrated point is already the most specific position available; there's
 * no finer "62% of the way to the next anchor" worth landing on for a
 * paginated document (decision 6 in the Teil B plan). `undefined` if this
 * voice has no calibration for the anchor at all.
 */
export function applyAnchorToFilesPosition(
  files: FileRef[],
  displayRecipe: DisplayRecipe | undefined,
  anchorMap: Record<string, VoiceAnchorPosition> | undefined,
  anchorId: string,
): ResolvedPage | undefined {
  const pos = anchorMap?.[anchorId];
  if (!pos) return undefined;
  return findRenderedPositionForSourcePage(files, displayRecipe, pos.fileIndex, pos.page);
}

/**
 * A device that receives an anchor id its own voice doesn't know about
 * walks back to the nearest earlier anchor (by `order`) it *does* know —
 * "no error, no dialog," per the spec. `undefined` if nothing known exists
 * at or before it (or if `targetAnchorId` isn't even in the song's list).
 */
export function resolveKnownAnchor(
  anchors: Anchor[],
  knownAnchorIds: Set<string>,
  targetAnchorId: string,
): string | undefined {
  const orderedAnchors = byOrder(anchors);
  const target = orderedAnchors.find((a) => a.id === targetAnchorId);
  if (!target) return undefined;

  let best: Anchor | undefined;
  for (const anchor of orderedAnchors) {
    if (anchor.order > target.order) break;
    if (knownAnchorIds.has(anchor.id)) best = anchor;
  }
  return best?.id;
}

export type SyncLevel = 'anchor' | 'page' | 'song' | 'offline';

/**
 * Which rung of the four-level fallback ladder is active right now (see
 * docs/adr/0010-anchor-sync.md) — purely for the UI indicator; it never
 * gates whether Follow Mode itself is *attempted*, only what it can
 * realistically promise. `resolvedVoices` is whatever the caller has
 * already resolved for each present member's assigned voice — an empty
 * `sha256s` marks a non-`files` (e.g. chordpro) voice, which can never
 * satisfy the "identical file" page-sync level.
 */
export function determineSyncLevel(input: {
  anchors: Anchor[];
  resolvedVoices: { userId: string; sha256s: string[] }[];
  online: boolean;
}): SyncLevel {
  if (!input.online) return 'offline';
  if (input.anchors.length > 0) return 'anchor';

  const { resolvedVoices } = input;
  const allIdenticalFiles =
    resolvedVoices.length > 0 &&
    resolvedVoices.every((v) => v.sha256s.length > 0) &&
    resolvedVoices.every((v) => v.sha256s.join('|') === resolvedVoices[0]!.sha256s.join('|'));

  return allIdenticalFiles ? 'page' : 'song';
}

const PAGE_SYNC_PREFIX = 'page:';

/**
 * The "page" fallback level's wire representation: a page number sent *as*
 * an anchor id, never as a field of its own (decision 3 in the Teil B
 * plan) — this is what keeps the Awareness payload single-shaped, so the
 * "no visual-position field" schema test holds regardless of which fallback
 * level is active. Only meaningful when `determineSyncLevel` returns
 * `'page'` — every present voice is confirmed identical at that point, so
 * a page number means the same thing to everyone without any per-voice
 * calibration.
 */
function buildPageSyncAnchorId(originalIndex: number): string {
  return `${PAGE_SYNC_PREFIX}${originalIndex}`;
}

function parsePageSyncAnchorId(anchorId: string): number | undefined {
  const match = /^page:(\d+)$/.exec(anchorId);
  return match ? Number(match[1]) : undefined;
}

/** Whether an incoming `anchorId` is a page-sync pseudo-anchor rather than a real one — callers branch their apply/fallback logic on this before touching `resolveKnownAnchor` (a page-sync id is never "unknown," it's resolved directly). */
export function isPageSyncAnchorId(anchorId: string): boolean {
  return parsePageSyncAnchorId(anchorId) !== undefined;
}

/** Builds this device's page-sync broadcast position — page-granular, `fraction` always 0 (no calibration exists to interpolate against at this level). `undefined` if the given page isn't part of `files` at all. */
export function computePageSyncPosition(files: FileRef[], fileIndex: number, page: number): StagePosition | undefined {
  const flat = flattenVoiceFiles(files).find((p) => p.fileIndex === fileIndex && p.pageNumberInFile === page);
  return flat ? { anchorId: buildPageSyncAnchorId(flat.originalIndex), fraction: 0 } : undefined;
}

/** Inverse: resolves a page-sync anchor id to a rendered position in *this* (identical) voice. `undefined` for anything that isn't a page-sync id, or a page index out of range. */
export function applyPageSyncPosition(
  files: FileRef[],
  displayRecipe: DisplayRecipe | undefined,
  anchorId: string,
): ResolvedPage | undefined {
  const originalIndex = parsePageSyncAnchorId(anchorId);
  if (originalIndex === undefined) return undefined;
  const page = flattenVoiceFiles(files)[originalIndex];
  return page ? findRenderedPositionForSourcePage(files, displayRecipe, page.fileIndex, page.pageNumberInFile) : undefined;
}
