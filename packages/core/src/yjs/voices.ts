// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs';
import type { FileRef } from '../files/schema';
import { type DisplayRecipe, type Voice, voiceSchema } from '../schemas/voice';

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
  // A display recipe's page indices are positions in the *current* files
  // array — removing a file shifts every later page's index, silently
  // pointing rotations/pageOrder at the wrong pages. Dropping the recipe
  // is the only correct move here; a file:detach is rare enough (admin
  // action, see ADR-0007) that "re-crop/re-rotate afterward" is fine.
  doc.getMap('voices').set(voiceId, voiceSchema.parse({ ...existing, files, displayRecipe: undefined }));
}

export interface FlatPage {
  /** Position in the sequence built by concatenating `files` in order — what `displayRecipe` keys/reorders against. */
  originalIndex: number;
  file: FileRef;
  /** 1-based — pdf.js pages are 1-based. */
  pageNumberInFile: number;
}

export function flattenVoiceFiles(files: FileRef[]): FlatPage[] {
  const pages: FlatPage[] = [];
  for (const file of files) {
    for (let pageNumberInFile = 1; pageNumberInFile <= file.pageCount; pageNumberInFile++) {
      pages.push({ originalIndex: pages.length, file, pageNumberInFile });
    }
  }
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
