// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

// e.g. "C", "F#m", "Bb" — a letter A-G, optional sharp/flat, optional minor.
export const musicalKeySchema = z
  .string()
  .regex(/^[A-G](#|b)?m?$/, 'must be a musical key like "C", "F#m", or "Bb"');

export const songStatusSchema = z.enum(['idea', 'active', 'archived']);

export const voteSchema = z.enum(['up', 'down']);

// No `body` field — a song's ChordPro content lives on a voice (see
// schemas/voice.ts and docs/adr/0004-parts-and-anchors.md), not here.
export const songSchema = z.object({
  title: z.string().min(1),
  // A name field, not free-flowing prose.
  artist: z.string().max(200),
  key: musicalKeySchema,
  bpm: z.number().int().positive(),
  durationSec: z.number().int().nonnegative(),
  status: songStatusSchema,
  // Generous for a long shared note about the song.
  bandNotes: z.string().max(5000),
  // 20 links, each well beyond any real URL's length, is far more than a
  // song reasonably needs to reference.
  links: z.array(z.string().max(2000)).max(20),
  votes: z.record(z.string(), voteSchema),
});

export type Song = z.infer<typeof songSchema>;
export type SongStatus = z.infer<typeof songStatusSchema>;
export type Vote = z.infer<typeof voteSchema>;

export const resolveIdeaTieInputSchema = z.strictObject({
  resolution: z.enum(['active', 'archived']),
});
export type ResolveIdeaTieInput = z.infer<typeof resolveIdeaTieInputSchema>;
