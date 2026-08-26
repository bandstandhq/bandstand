// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

// A logical position within a song, never a rendering coordinate — see
// docs/adr/0004-parts-and-anchors.md (why) and docs/adr/0010-anchor-sync.md
// (the anchor-based sync this type now serves). `anchorId` names a song
// anchor (schemas/anchor.ts); `fraction` is how far this device's voice has
// progressed from that anchor toward the next known one (0 = right at the
// anchor, 1 = right at the next one) — meaningless once there's no next
// known anchor, in which case it's always 0, not some other placeholder.
// This was originally `{sectionIndex, fraction}`, tied to a single ChordPro
// voice's render model; the type changed, not its callers.
export const stagePositionSchema = z.object({
  anchorId: z.string(),
  fraction: z.number().min(0).max(1),
});

export type StagePosition = z.infer<typeof stagePositionSchema>;

/**
 * `undefined` when there's no anchor to start from (a song with none yet) —
 * a single representation for "no position," matching
 * `StageAwarenessState.position` already being optional rather than ever
 * needing a sentinel value inside a present-but-meaningless object.
 */
export function createInitialStagePosition(firstAnchorId?: string): StagePosition | undefined {
  return firstAnchorId ? { anchorId: firstAnchorId, fraction: 0 } : undefined;
}
