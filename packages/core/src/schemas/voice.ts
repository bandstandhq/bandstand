// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

// A song's ChordPro content lives on a voice, not the song itself — see
// docs/adr/0004-parts-and-anchors.md. Exactly one voice per song in this
// milestone, but the schema doesn't assume that going forward.
export const voiceSchema = z.object({
  songId: z.string(),
  name: z.string().min(1),
  body: z.string(), // ChordPro
});

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
