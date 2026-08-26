// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { fileRefSchema } from '../files/schema';

// A song's content lives on a voice, not the song itself — see
// docs/adr/0004-parts-and-anchors.md. Milestone 1 always created exactly
// one ChordPro voice per song; Milestone 2 makes that additive — a song can
// now have any number of voices, some ChordPro, some scanned files (for
// musicians who read written parts) — see docs/adr/0008-multi-voice-songs.md.
const voiceBaseFields = {
  songId: z.string(),
  name: z.string().min(1),
  // e.g. "Trumpet in B", set on a voice so assignment can guess a match
  // from a member's own instrument — see yjs/assignments.ts.
  instrument: z.string().optional(),
};

const chordproVoiceSchema = z.object({
  ...voiceBaseFields,
  kind: z.literal('chordpro'),
  body: z.string(),
});

// A page's position in the flat sequence built by concatenating `files` in
// order (0 = first page of the first file) — the identity `rotations` keys
// against and `pageOrder` reorders/duplicates, independent of how the
// result is actually displayed. Applied at render time only; never mutates
// the underlying file. See docs/adr/0009-voice-display-recipe.md.
const cropMarginsSchema = z.object({
  top: z.number().min(0).max(0.49),
  right: z.number().min(0).max(0.49),
  bottom: z.number().min(0).max(0.49),
  left: z.number().min(0).max(0.49),
});

export type CropMargins = z.infer<typeof cropMarginsSchema>;

const displayRecipeSchema = z.object({
  // A single crop, in fractions of page width/height, applied to every
  // page — most scans have consistent margins throughout a voice, so this
  // isn't per-page (unlike rotation, where one sideways-scanned page in an
  // otherwise-straight set is a real, common case).
  cropMargins: cropMarginsSchema.optional(),
  // Keyed by original page index (as a string — object keys are always
  // strings; see `originalPageIndex` in yjs/voices.ts).
  rotations: z.record(z.string(), z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])).optional(),
  // The rendered sequence, as original page indices — reordering is a
  // permutation, duplicating a page is that index repeated. No separate
  // "duplicated pages" list: this array alone is the complete sequence, so
  // there's nothing else that could disagree with it.
  pageOrder: z.array(z.number().int().nonnegative()).optional(),
});

export type DisplayRecipe = z.infer<typeof displayRecipeSchema>;

const filesVoiceSchema = z.object({
  ...voiceBaseFields,
  kind: z.literal('files'),
  // Multiple files are one continuous page sequence, in array order — a
  // scan split across several files shouldn't force separate voices.
  files: z.array(fileRefSchema).min(1),
  displayRecipe: displayRecipeSchema.optional(),
});

const voiceUnionSchema = z.discriminatedUnion('kind', [chordproVoiceSchema, filesVoiceSchema]);

/**
 * A voice stored before this change has no `kind` field at all — treating
 * that as `'chordpro'` is what makes this schema change additive rather
 * than a migration: every voice written under Milestone 1 still parses.
 */
export const voiceSchema = z.preprocess((input) => {
  if (input && typeof input === 'object' && !('kind' in input)) {
    return { ...input, kind: 'chordpro' };
  }
  return input;
}, voiceUnionSchema);

export type Voice = z.infer<typeof voiceSchema>;

/**
 * This milestone always creates exactly one voice per song, at this
 * deterministic id — a real voice-selection UI later replaces direct id
 * lookups like this with picking from whatever voices actually exist for
 * a song, but for now it avoids a full scan of the voices map.
 */
export function getDefaultVoiceId(songId: string): string {
  return `voice:${songId}`;
}
