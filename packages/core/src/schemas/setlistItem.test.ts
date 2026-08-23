// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { setlistItemSchema } from './setlistItem';

describe('setlistItemSchema', () => {
  it('accepts a song item with songId', () => {
    expect(() =>
      setlistItemSchema.parse({ id: '1', type: 'song', songId: 'song-1' }),
    ).not.toThrow();
  });

  it('rejects a song item missing songId', () => {
    expect(() => setlistItemSchema.parse({ id: '1', type: 'song' })).toThrow();
  });

  it('rejects a break item carrying a stray songId', () => {
    expect(() =>
      setlistItemSchema.parse({ id: '1', type: 'break', breakMinutes: 10, songId: 'song-1' }),
    ).toThrow();
  });

  it('accepts a valid break item', () => {
    expect(() =>
      setlistItemSchema.parse({ id: '1', type: 'break', breakMinutes: 15 }),
    ).not.toThrow();
  });

  it('accepts a finale item with no extra fields', () => {
    expect(() => setlistItemSchema.parse({ id: '1', type: 'finale' })).not.toThrow();
  });

  it('validates overrideKey against the musical-key format', () => {
    expect(() =>
      setlistItemSchema.parse({ id: '1', type: 'song', songId: 's1', overrideKey: 'F#m' }),
    ).not.toThrow();
    expect(() =>
      setlistItemSchema.parse({ id: '1', type: 'song', songId: 's1', overrideKey: 'H' }),
    ).toThrow();
  });
});
