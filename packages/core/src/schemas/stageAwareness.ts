// SPDX-License-Identifier: Apache-2.0
//
// The Stage layer's Awareness payload — ephemeral, never persisted (see
// docs/ARCHITECTURE.md's "Stage" section). Broadcast over the same
// Hocuspocus connection as the band document, but through Yjs's Awareness
// protocol, not the document itself.
import { z } from 'zod';
import { stagePositionSchema } from './stagePosition';

export const stageAwarenessSchema = z.object({
  userId: z.string(),
  setlistId: z.string(),
  itemId: z.string(),
  // Absent at the "song only" and "offline" fallback levels (see
  // docs/adr/0010-anchor-sync.md's four-level ladder) — there's nothing
  // meaningful to broadcast below the "same file" page-sync level, which
  // itself rides in `position.anchorId` as a synthetic per-page id, never a
  // page-number field of its own. This is the entire reason the ladder
  // needs only ever one position-shaped field, not a second for "page."
  position: stagePositionSchema.optional(),
  // Ephemeral, semitone offset — resets to the stored key on Stage Mode
  // exit, never written back to the song (see ARCHITECTURE.md).
  liveTranspose: z.number().int(),
  // Whether this user is open to being followed — there's no fixed
  // leader; anyone can pick anyone to follow (see the brief's Follow Mode).
  isLeaderCandidate: z.boolean(),
});

export type StageAwarenessState = z.infer<typeof stageAwarenessSchema>;
