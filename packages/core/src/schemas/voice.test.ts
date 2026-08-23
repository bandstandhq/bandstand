// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { getDefaultVoiceId, voiceSchema } from './voice';

describe('voiceSchema', () => {
  it('accepts a minimal valid voice', () => {
    const voice = { songId: 's1', name: 'Default', body: '{title: Test}' };
    expect(voiceSchema.parse(voice)).toEqual(voice);
  });

  it('rejects an empty name', () => {
    expect(() => voiceSchema.parse({ songId: 's1', name: '', body: '' })).toThrow();
  });

  it('rejects a missing songId', () => {
    expect(() => voiceSchema.parse({ name: 'Default', body: '' })).toThrow();
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
