// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { getDefaultVoiceId, voiceSchema } from './voice';

describe('voiceSchema', () => {
  it('accepts a minimal valid chordpro voice', () => {
    const voice = { songId: 's1', name: 'Default', kind: 'chordpro', body: '{title: Test}' };
    expect(voiceSchema.parse(voice)).toEqual(voice);
  });

  it('treats a voice with no kind field at all as chordpro — Milestone 1 back-compat', () => {
    const legacyVoice = { songId: 's1', name: 'Default', body: '{title: Test}' };
    expect(voiceSchema.parse(legacyVoice)).toEqual({ ...legacyVoice, kind: 'chordpro' });
  });

  it('accepts a files voice with an instrument', () => {
    const voice = {
      songId: 's1',
      name: 'Trumpet in B',
      kind: 'files',
      instrument: 'Trumpet',
      files: [{ sha256: 'a'.repeat(64), filename: 'part.pdf', mime: 'application/pdf', pageCount: 2 }],
    };
    expect(voiceSchema.parse(voice)).toEqual(voice);
  });

  it('rejects a files voice with an empty files array', () => {
    expect(() => voiceSchema.parse({ songId: 's1', name: 'Trumpet', kind: 'files', files: [] })).toThrow();
  });

  it('rejects a chordpro voice with a files field but no body', () => {
    expect(() =>
      voiceSchema.parse({
        songId: 's1',
        name: 'Trumpet',
        kind: 'chordpro',
        files: [{ sha256: 'a'.repeat(64), filename: 'part.pdf', mime: 'application/pdf', pageCount: 2 }],
      }),
    ).toThrow();
  });

  it('rejects an empty name', () => {
    expect(() => voiceSchema.parse({ songId: 's1', name: '', kind: 'chordpro', body: '' })).toThrow();
  });

  it('rejects a missing songId', () => {
    expect(() => voiceSchema.parse({ name: 'Default', kind: 'chordpro', body: '' })).toThrow();
  });
});

describe('getDefaultVoiceId', () => {
  it('is deterministic per songId', () => {
    expect(getDefaultVoiceId('song-1')).toBe(getDefaultVoiceId('song-1'));
  });

  it('differs across songIds', () => {
    expect(getDefaultVoiceId('song-1')).not.toBe(getDefaultVoiceId('song-2'));
  });
});
