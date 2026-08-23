// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs';
import { type Voice, voiceSchema } from '../schemas/voice';

export function getVoice(doc: Y.Doc, voiceId: string): Voice | undefined {
  return doc.getMap('voices').get(voiceId) as Voice | undefined;
}

/** Updates a voice's ChordPro content (the song editor's live-save target). */
export function updateVoiceBody(doc: Y.Doc, voiceId: string, body: string): void {
  const existing = getVoice(doc, voiceId);
  if (!existing) throw new Error(`Voice not found: ${voiceId}`);
  doc.getMap('voices').set(voiceId, voiceSchema.parse({ ...existing, body }));
}
