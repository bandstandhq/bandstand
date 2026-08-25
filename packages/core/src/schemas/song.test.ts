// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { resolveIdeaTieInputSchema, songSchema } from './song';

const validSong = {
  title: 'Wonderwall',
  artist: 'Oasis',
  key: 'F#m',
  bpm: 87,
  durationSec: 258,
  status: 'active' as const,
  bandNotes: '',
  links: [],
  votes: {},
};

describe('songSchema', () => {
  it('accepts a minimal valid song', () => {
    expect(songSchema.parse(validSong)).toEqual(validSong);
  });

  it('rejects a missing title', () => {
    const { title: _title, ...rest } = validSong;
    expect(() => songSchema.parse(rest)).toThrow();
  });

  it('rejects a status outside idea|active|archived', () => {
    expect(() => songSchema.parse({ ...validSong, status: 'draft' })).toThrow();
  });

  it('accepts only up|down vote values, keyed by userId', () => {
    expect(() =>
      songSchema.parse({ ...validSong, votes: { 'user-1': 'up', 'user-2': 'down' } }),
    ).not.toThrow();
    expect(() => songSchema.parse({ ...validSong, votes: { 'user-1': 'maybe' } })).toThrow();
  });

  it('rejects non-array links', () => {
    expect(() => songSchema.parse({ ...validSong, links: 'https://example.com' })).toThrow();
  });
});

describe('resolveIdeaTieInputSchema', () => {
  it('accepts active or archived', () => {
    expect(resolveIdeaTieInputSchema.parse({ resolution: 'active' })).toEqual({ resolution: 'active' });
    expect(resolveIdeaTieInputSchema.parse({ resolution: 'archived' })).toEqual({ resolution: 'archived' });
  });

  it('rejects any other resolution', () => {
    expect(() => resolveIdeaTieInputSchema.parse({ resolution: 'idea' })).toThrow();
  });

  it('rejects unknown extra fields', () => {
    expect(() => resolveIdeaTieInputSchema.parse({ resolution: 'active', extra: true })).toThrow();
  });
});
