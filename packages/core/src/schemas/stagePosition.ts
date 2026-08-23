// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

// A logical position within a song's content, not a scroll coordinate —
// see docs/adr/0004-parts-and-anchors.md. `sectionIndex` indexes into the
// ChordPro render model's sections (packages/chords' buildRenderModel);
// `fraction` is how far through that section (0 = start, 1 = end). Once
// multiple voices per song exist, this becomes a real anchor id instead —
// callers of this type don't need to change when that happens, only its
// internal shape does.
export const stagePositionSchema = z.object({
  sectionIndex: z.number().int().nonnegative(),
  fraction: z.number().min(0).max(1),
});

export type StagePosition = z.infer<typeof stagePositionSchema>;

export function createInitialStagePosition(): StagePosition {
  return { sectionIndex: 0, fraction: 0 };
}
