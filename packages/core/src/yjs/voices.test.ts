// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { addSong } from './songs';
import { getVoice, updateVoiceBody } from './voices';
import { getDefaultVoiceId } from '../schemas/voice';

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

    expect(getVoice(doc, getDefaultVoiceId(songId))?.body).toBe('original');
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
    expect(voice).toEqual({ songId, name: 'Default', body: 'updated content' });
  });

  it('throws for a nonexistent voice', () => {
    const doc = new Y.Doc();
    expect(() => updateVoiceBody(doc, 'missing', 'x')).toThrow('Voice not found');
  });
});
