// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { getAssignedVoiceId, getAssignment, setAssignment } from './assignments';
import { createVoice } from './voices';

function seedSongVoices(doc: Y.Doc, songId: string) {
  const chordproId = createVoice(doc, songId, { name: 'Leadsheet', kind: 'chordpro', body: '{title: Test}' });
  const trumpetId = createVoice(doc, songId, {
    name: 'Trumpet in B',
    kind: 'files',
    instrument: 'Trumpet',
    files: [{ sha256: 'a'.repeat(64), filename: 'trumpet.pdf', mime: 'application/pdf', pageCount: 1 }],
  });
  return { chordproId, trumpetId };
}

describe('getAssignment / setAssignment', () => {
  it('has no assignment until one is set', () => {
    const doc = new Y.Doc();
    expect(getAssignment(doc, 'song-1', 'user-1')).toBeUndefined();
  });

  it('stores an assignment keyed by songId and userId independently', () => {
    const doc = new Y.Doc();
    setAssignment(doc, 'song-1', 'user-1', 'voice:a');
    setAssignment(doc, 'song-1', 'user-2', 'voice:b');
    setAssignment(doc, 'song-2', 'user-1', 'voice:c');

    expect(getAssignment(doc, 'song-1', 'user-1')).toBe('voice:a');
    expect(getAssignment(doc, 'song-1', 'user-2')).toBe('voice:b');
    expect(getAssignment(doc, 'song-2', 'user-1')).toBe('voice:c');
  });
});

describe('getAssignedVoiceId', () => {
  it('returns undefined for a song with no voices at all', () => {
    const doc = new Y.Doc();
    expect(getAssignedVoiceId(doc, 'song-1', 'user-1')).toBeUndefined();
  });

  it('prefers an explicit assignment over any guess', () => {
    const doc = new Y.Doc();
    const { chordproId, trumpetId } = seedSongVoices(doc, 'song-1');
    setAssignment(doc, 'song-1', 'user-1', chordproId);

    expect(getAssignedVoiceId(doc, 'song-1', 'user-1', ['Trumpet'])).toBe(chordproId);
    expect(trumpetId).toBeDefined();
  });

  it('guesses from one of the member\'s instruments when no explicit assignment exists', () => {
    const doc = new Y.Doc();
    const { trumpetId } = seedSongVoices(doc, 'song-1');

    expect(getAssignedVoiceId(doc, 'song-1', 'user-1', ['Vocals', 'Trumpet'])).toBe(trumpetId);
  });

  it('falls back to the first voice by insertion order when no instrument matches', () => {
    const doc = new Y.Doc();
    const { chordproId } = seedSongVoices(doc, 'song-1');

    expect(getAssignedVoiceId(doc, 'song-1', 'user-1', ['Tuba'])).toBe(chordproId);
    expect(getAssignedVoiceId(doc, 'song-1', 'user-1')).toBe(chordproId);
  });
});
