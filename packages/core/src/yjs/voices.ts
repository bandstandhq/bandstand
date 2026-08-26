// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs';
import type { Anchor } from '../schemas/anchor';
import type { FileRef } from '../files/schema';
import { type DisplayRecipe, type Voice, type VoiceAnchorPosition, voiceSchema } from '../schemas/voice';
import { matchAnchorsToChordProSections } from './anchors';

export function getVoice(doc: Y.Doc, voiceId: string): Voice | undefined {
  return doc.getMap('voices').get(voiceId) as Voice | undefined;
}

/** Updates a voice's ChordPro content (the song editor's live-save target). */
export function updateVoiceBody(doc: Y.Doc, voiceId: string, body: string): void {
  const existing = getVoice(doc, voiceId);
  if (!existing) throw new Error(`Voice not found: ${voiceId}`);
  doc.getMap('voices').set(voiceId, voiceSchema.parse({ ...existing, body }));
}

/** Every voice belonging to a song, in insertion order (Y.Map preserves it). */
export function listVoicesForSong(doc: Y.Doc, songId: string): Array<{ id: string; voice: Voice }> {
  const result: Array<{ id: string; voice: Voice }> = [];
  doc.getMap('voices').forEach((raw, id) => {
    const voice = voiceSchema.parse(raw);
    if (voice.songId === songId) result.push({ id, voice });
  });
  return result;
}

// A plain `Omit<Voice, 'songId'>` would collapse the discriminated union to
// only its shared fields, losing the kind-specific ones — a distributive
// conditional type only distributes over a naked generic type parameter, so
// this needs its own generic helper rather than applying Omit to Voice
// directly. Keeps `kind: 'files'` voices requiring `files` and
// `kind: 'chordpro'` voices requiring `body`.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewVoiceInput = DistributiveOmit<Voice, 'songId'>;

/** Adds another voice to a song that already has one — the additive path ADR-0008 exists for. */
export function createVoice(doc: Y.Doc, songId: string, input: NewVoiceInput): string {
  const voiceId = `voice:${crypto.randomUUID()}`;
  const voice = voiceSchema.parse({ ...input, songId });
  doc.getMap('voices').set(voiceId, voice);
  return voiceId;
}

/** Removes one file from a `files`-kind voice — used by the admin-only file:detach route. */
export function detachVoiceFile(doc: Y.Doc, voiceId: string, sha256: string): void {
  const existing = getVoice(doc, voiceId);
  if (!existing) throw new Error(`Voice not found: ${voiceId}`);
  if (existing.kind !== 'files') throw new Error(`Voice is not a files voice: ${voiceId}`);

  const files = existing.files.filter((f) => f.sha256 !== sha256);
  // Both a display recipe and an anchorMap key by a page's position in the
  // *current* files array — removing a file shifts every later file's
  // index, silently pointing either at the wrong page (not merely at a
  // now-invalid one: a shifted index can still be in range, just wrong).
  // Dropping both is the only correct move here; a file:detach is rare
  // enough (admin action, see ADR-0007) that re-crop/re-calibrate
  // afterward is fine.
  doc
    .getMap('voices')
    .set(voiceId, voiceSchema.parse({ ...existing, files, displayRecipe: undefined, anchorMap: undefined }));
}

export interface FlatPage {
  /** Position in the sequence built by concatenating `files` in order — what `displayRecipe` keys/reorders against. */
  originalIndex: number;
  /** This page's file's position in `files` — what an anchorMap entry's `fileIndex` addresses. */
  fileIndex: number;
  file: FileRef;
  /** 1-based — pdf.js pages are 1-based. */
  pageNumberInFile: number;
}

export function flattenVoiceFiles(files: FileRef[]): FlatPage[] {
  const pages: FlatPage[] = [];
  files.forEach((file, fileIndex) => {
    for (let pageNumberInFile = 1; pageNumberInFile <= file.pageCount; pageNumberInFile++) {
      pages.push({ originalIndex: pages.length, fileIndex, file, pageNumberInFile });
    }
  });
  return pages;
}

export interface ResolvedPage extends FlatPage {
  /** Position in the *rendered* sequence — differs from originalIndex once reordered or duplicated. */
  position: number;
  rotation: 0 | 90 | 180 | 270;
}

/**
 * The actual sequence to display: `displayRecipe.pageOrder` applied (dup =
 * repeated index, reorder = permutation), each page's rotation looked up by
 * its original index. No recipe at all means natural file order, no
 * rotation — every existing `files` voice from before A3.2 already parses
 * this way.
 */
export function resolveDisplaySequence(files: FileRef[], displayRecipe?: DisplayRecipe): ResolvedPage[] {
  const basePages = flattenVoiceFiles(files);
  const order = displayRecipe?.pageOrder ?? basePages.map((_, i) => i);

  return order
    .filter((originalIndex) => originalIndex >= 0 && originalIndex < basePages.length)
    .map((originalIndex, position) => ({
      ...basePages[originalIndex]!,
      position,
      rotation: displayRecipe?.rotations?.[String(originalIndex)] ?? 0,
    }));
}

/** Persists crop/rotation/order changes — a `files` voice's display recipe never touches the underlying file. */
export function setVoiceDisplayRecipe(doc: Y.Doc, voiceId: string, displayRecipe: DisplayRecipe): void {
  const existing = getVoice(doc, voiceId);
  if (!existing) throw new Error(`Voice not found: ${voiceId}`);
  if (existing.kind !== 'files') throw new Error(`Voice is not a files voice: ${voiceId}`);
  doc.getMap('voices').set(voiceId, voiceSchema.parse({ ...existing, displayRecipe }));
}

/**
 * Resolves a source page (`fileIndex` into `files`, 1-based `page` within
 * it — an anchorMap entry's own addressing, see schemas/voice.ts) to where
 * it currently sits in the *rendered* sequence, applying whatever the
 * voice's display recipe currently does (reorder/rotate/duplicate). A
 * calibrated anchor is never invalidated by later reordering/duplicating —
 * only by removing the underlying file (`detachVoiceFile` already drops the
 * whole `anchorMap` in that case). A duplicated page resolves to its first
 * occurrence in `pageOrder` — an arbitrary but deterministic tie-break.
 */
export function findRenderedPositionForSourcePage(
  files: FileRef[],
  displayRecipe: DisplayRecipe | undefined,
  fileIndex: number,
  page: number,
): ResolvedPage | undefined {
  return resolveDisplaySequence(files, displayRecipe).find(
    (resolved) => resolved.fileIndex === fileIndex && resolved.pageNumberInFile === page,
  );
}

/** Records where an anchor falls in a `files` voice's source content — see schemas/voice.ts's `anchorPositionSchema`. */
export function setVoiceAnchorPosition(doc: Y.Doc, voiceId: string, anchorId: string, position: VoiceAnchorPosition): void {
  const existing = getVoice(doc, voiceId);
  if (!existing) throw new Error(`Voice not found: ${voiceId}`);
  if (existing.kind !== 'files') throw new Error(`Voice is not a files voice: ${voiceId}`);
  const anchorMap = { ...existing.anchorMap, [anchorId]: position };
  doc.getMap('voices').set(voiceId, voiceSchema.parse({ ...existing, anchorMap }));
}

export function clearVoiceAnchorPosition(doc: Y.Doc, voiceId: string, anchorId: string): void {
  const existing = getVoice(doc, voiceId);
  if (!existing) throw new Error(`Voice not found: ${voiceId}`);
  if (existing.kind !== 'files') throw new Error(`Voice is not a files voice: ${voiceId}`);
  if (!existing.anchorMap || !(anchorId in existing.anchorMap)) return;
  const anchorMap = { ...existing.anchorMap };
  delete anchorMap[anchorId];
  doc.getMap('voices').set(voiceId, voiceSchema.parse({ ...existing, anchorMap }));
}

export interface AnchorCalibrationProgress {
  done: number;
  total: number;
}

/**
 * Uniform "how ready is this voice" count across both voice kinds — used
 * for the per-voice and band-wide calibration-progress UI (see
 * docs/adr/0010-anchor-sync.md). For a `files` voice, `done` counts anchors
 * present in `anchorMap`; for a `chordpro` voice, which never stores its
 * own mapping, `done` counts anchors matched against `chordProSections`
 * (pass the voice's `RenderModel.sections`, or omit if unavailable — no
 * ChordPro voice ever reports progress without it, since the caller is
 * expected to have already parsed the voice to render it).
 */
export function getAnchorCalibrationProgress(
  voice: Voice,
  anchors: Anchor[],
  chordProSections?: { label: string | null }[],
): AnchorCalibrationProgress {
  const total = anchors.length;
  if (voice.kind === 'files') {
    const done = anchors.filter((anchor) => voice.anchorMap?.[anchor.id] !== undefined).length;
    return { done, total };
  }
  const done = chordProSections ? matchAnchorsToChordProSections(anchors, chordProSections).size : 0;
  return { done, total };
}
