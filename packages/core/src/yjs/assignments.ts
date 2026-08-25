// SPDX-License-Identifier: Apache-2.0
//
// Which voice each member plays for a given song — a band-wide, collaborative
// Y.Map (not per-user local state), so everyone sees who plays what. See
// docs/adr/0008-multi-voice-songs.md.
import * as Y from 'yjs';
import { listVoicesForSong } from './voices';

function assignmentKey(songId: string, userId: string): string {
  return `${songId}:${userId}`;
}

export function getAssignment(doc: Y.Doc, songId: string, userId: string): string | undefined {
  return doc.getMap('assignments').get(assignmentKey(songId, userId)) as string | undefined;
}

export function setAssignment(doc: Y.Doc, songId: string, userId: string, voiceId: string): void {
  doc.getMap('assignments').set(assignmentKey(songId, userId), voiceId);
}

/**
 * The voice a member should see for a song: their explicit assignment if
 * one exists, else a voice whose `instrument` matches one of theirs (a
 * member's `band_members.instruments` is a list — they may play more than
 * one), else the song's first voice (insertion order — the original
 * ChordPro voice for any song that predates Milestone 2). `undefined` only
 * if the song has no voices at all, which shouldn't happen for a real song.
 */
export function getAssignedVoiceId(
  doc: Y.Doc,
  songId: string,
  userId: string,
  memberInstruments?: string[],
): string | undefined {
  const explicit = getAssignment(doc, songId, userId);
  if (explicit) return explicit;

  const voices = listVoicesForSong(doc, songId);
  if (voices.length === 0) return undefined;

  if (memberInstruments && memberInstruments.length > 0) {
    const match = voices.find(({ voice }) => voice.instrument && memberInstruments.includes(voice.instrument));
    if (match) return match.id;
  }

  return voices[0]!.id;
}
