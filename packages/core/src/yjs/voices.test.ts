// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { addSong } from './songs';
import { createVoice, detachVoiceFile, getVoice, listVoicesForSong, updateVoiceBody } from './voices';
import { getDefaultVoiceId } from '../schemas/voice';

const fileRef = (sha256: string) => ({ sha256, filename: 'part.pdf', mime: 'application/pdf', pageCount: 1 });

describe('getVoice / updateVoiceBody', () => {
  it('reads the voice created by addSong', () => {
    const doc = new Y.Doc();
    const songId = addSong(doc, {
      title: 'Song',
      artist: '',
      key: 'C',
      bpm: 100,
      durationSec: 100,
      status: 'active',
      body: 'original',
    });

    const voice = getVoice(doc, getDefaultVoiceId(songId));
    expect(voice?.kind === 'chordpro' ? voice.body : undefined).toBe('original');
  });

  it('updates only the body, preserving songId/name', () => {
    const doc = new Y.Doc();
    const songId = addSong(doc, {
      title: 'Song',
      artist: '',
      key: 'C',
      bpm: 100,
      durationSec: 100,
      status: 'active',
      body: 'original',
    });
    const voiceId = getDefaultVoiceId(songId);

    updateVoiceBody(doc, voiceId, 'updated content');

    const voice = getVoice(doc, voiceId);
    expect(voice).toEqual({ songId, name: 'Default', kind: 'chordpro', body: 'updated content' });
  });

  it('throws for a nonexistent voice', () => {
    const doc = new Y.Doc();
    expect(() => updateVoiceBody(doc, 'missing', 'x')).toThrow('Voice not found');
  });
});

describe('listVoicesForSong / createVoice', () => {
  it('lists only voices for the given song, in insertion order', () => {
    const doc = new Y.Doc();
    const songId = addSong(doc, {
      title: 'Song',
      artist: '',
      key: 'C',
      bpm: 100,
      durationSec: 100,
      status: 'active',
      body: 'original',
    });
    const otherSongId = addSong(doc, {
      title: 'Other',
      artist: '',
      key: 'C',
      bpm: 100,
      durationSec: 100,
      status: 'active',
      body: 'other',
    });
    const trumpetId = createVoice(doc, songId, {
      name: 'Trumpet in B',
      kind: 'files',
      instrument: 'Trumpet',
      files: [fileRef('a'.repeat(64))],
    });

    const voices = listVoicesForSong(doc, songId);
    expect(voices.map((v) => v.id)).toEqual([getDefaultVoiceId(songId), trumpetId]);
    expect(listVoicesForSong(doc, otherSongId)).toHaveLength(1);
  });

  it('creates a files voice with a fresh id, distinct from the default voice id', () => {
    const doc = new Y.Doc();
    const songId = addSong(doc, {
      title: 'Song',
      artist: '',
      key: 'C',
      bpm: 100,
      durationSec: 100,
      status: 'active',
      body: 'original',
    });

    const voiceId = createVoice(doc, songId, { name: 'Trombone', kind: 'files', files: [fileRef('b'.repeat(64))] });

    expect(voiceId).not.toBe(getDefaultVoiceId(songId));
    const voice = getVoice(doc, voiceId);
    expect(voice).toEqual({ songId, name: 'Trombone', kind: 'files', files: [fileRef('b'.repeat(64))] });
  });
});

describe('detachVoiceFile', () => {
  it('removes one file, keeping the rest', () => {
    const doc = new Y.Doc();
    const voiceId = createVoice(doc, 'song-1', {
      name: 'Trumpet',
      kind: 'files',
      files: [fileRef('a'.repeat(64)), fileRef('b'.repeat(64))],
    });

    detachVoiceFile(doc, voiceId, 'a'.repeat(64));

    const voice = getVoice(doc, voiceId);
    expect(voice?.kind === 'files' ? voice.files.map((f) => f.sha256) : []).toEqual(['b'.repeat(64)]);
  });

  it('throws for a nonexistent voice', () => {
    const doc = new Y.Doc();
    expect(() => detachVoiceFile(doc, 'missing', 'a'.repeat(64))).toThrow('Voice not found');
  });

  it('throws for a chordpro voice', () => {
    const doc = new Y.Doc();
    const voiceId = createVoice(doc, 'song-1', { name: 'Lead', kind: 'chordpro', body: 'x' });
    expect(() => detachVoiceFile(doc, voiceId, 'a'.repeat(64))).toThrow('not a files voice');
  });

  it('throws when removing the last file, since a files voice needs at least one', () => {
    const doc = new Y.Doc();
    const voiceId = createVoice(doc, 'song-1', { name: 'Trumpet', kind: 'files', files: [fileRef('a'.repeat(64))] });
    expect(() => detachVoiceFile(doc, voiceId, 'a'.repeat(64))).toThrow();
  });
});
