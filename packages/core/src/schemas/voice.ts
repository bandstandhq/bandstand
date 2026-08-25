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

const filesVoiceSchema = z.object({
  ...voiceBaseFields,
  kind: z.literal('files'),
  // Multiple files are one continuous page sequence, in array order — a
  // scan split across several files shouldn't force separate voices.
  files: z.array(fileRefSchema).min(1),
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
