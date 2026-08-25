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

/** Every voice belonging to a song, in insertion order (Y.Map preserves it). */
export function listVoicesForSong(doc: Y.Doc, songId: string): Array<{ id: string; voice: Voice }> {
  const result: Array<{ id: string; voice: Voice }> = [];
  doc.getMap('voices').forEach((raw, id) => {
    const voice = voiceSchema.parse(raw);
    if (voice.songId === songId) result.push({ id, voice });
  });
  return result;
}

// A plain `Omit<Voice, 'songId'>` would collapse the discriminated union to
// only its shared fields, losing the kind-specific ones — a distributive
// conditional type only distributes over a naked generic type parameter, so
// this needs its own generic helper rather than applying Omit to Voice
// directly. Keeps `kind: 'files'` voices requiring `files` and
// `kind: 'chordpro'` voices requiring `body`.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewVoiceInput = DistributiveOmit<Voice, 'songId'>;

/** Adds another voice to a song that already has one — the additive path ADR-0008 exists for. */
export function createVoice(doc: Y.Doc, songId: string, input: NewVoiceInput): string {
  const voiceId = `voice:${crypto.randomUUID()}`;
  const voice = voiceSchema.parse({ ...input, songId });
  doc.getMap('voices').set(voiceId, voice);
  return voiceId;
}

/** Removes one file from a `files`-kind voice — used by the admin-only file:detach route. */
export function detachVoiceFile(doc: Y.Doc, voiceId: string, sha256: string): void {
  const existing = getVoice(doc, voiceId);
  if (!existing) throw new Error(`Voice not found: ${voiceId}`);
  if (existing.kind !== 'files') throw new Error(`Voice is not a files voice: ${voiceId}`);

  const files = existing.files.filter((f) => f.sha256 !== sha256);
  doc.getMap('voices').set(voiceId, voiceSchema.parse({ ...existing, files }));
}
