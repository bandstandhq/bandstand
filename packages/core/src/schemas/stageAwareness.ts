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
  position: stagePositionSchema,
  // Ephemeral, semitone offset — resets to the stored key on Stage Mode
  // exit, never written back to the song (see ARCHITECTURE.md).
  liveTranspose: z.number().int(),
  // Whether this user is open to being followed — there's no fixed
  // leader; anyone can pick anyone to follow (see the brief's Follow Mode).
  isLeaderCandidate: z.boolean(),
});

export type StageAwarenessState = z.infer<typeof stageAwarenessSchema>;
