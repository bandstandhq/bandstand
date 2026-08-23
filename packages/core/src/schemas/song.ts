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
  artist: z.string(),
  key: musicalKeySchema,
  bpm: z.number().int().positive(),
  durationSec: z.number().int().nonnegative(),
  status: songStatusSchema,
  bandNotes: z.string(),
  links: z.array(z.string()),
  votes: z.record(z.string(), voteSchema),
});

export type Song = z.infer<typeof songSchema>;
export type SongStatus = z.infer<typeof songStatusSchema>;
export type Vote = z.infer<typeof voteSchema>;
