// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

// A musical position shared across every voice of a song — "Intro", "Verse
// 2", "Letter B", "bar 33" — not a rendering coordinate. See
// docs/adr/0004-parts-and-anchors.md (the anchor concept it anticipated) and
// docs/adr/0010-anchor-sync.md (the full design this schema serves). Anchors
// are band-wide and song-scoped, not per-voice: a voice's own anchorMap
// (packages/core/src/schemas/voice.ts) points into this list, it never
// duplicates it.
export const anchorSchema = z.object({
  id: z.string(),
  label: z.string().min(1),
  // Position within the song's anchor list — the ordering everything else
  // (nearest-known-anchor fallback, ChordPro/files calibration progress)
  // walks. Not necessarily contiguous; only relative order matters.
  order: z.number().int().nonnegative(),
  bar: z.number().int().positive().optional(),
  timeMs: z.number().nonnegative().optional(),
});

export type Anchor = z.infer<typeof anchorSchema>;
