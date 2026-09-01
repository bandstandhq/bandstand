// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { MyBand } from '@bandstand/api-client';
import { bandOptionLabel } from './bandOptionLabel';

function band(overrides: Partial<MyBand> = {}): MyBand {
  return { id: 'id-1', name: 'The Demo Band', slug: 'demo-band', role: 'member', ...overrides };
}

describe('bandOptionLabel', () => {
  it('is just the name when no other band of this user shares it', () => {
    const bands = [band({ id: 'a', name: 'The Demo Band' }), band({ id: 'b', name: 'Second Fiddle', slug: 'second-fiddle' })];
    expect(bandOptionLabel(bands[0]!, bands)).toBe('The Demo Band');
    expect(bandOptionLabel(bands[1]!, bands)).toBe('Second Fiddle');
  });

  it('appends the slug when two of this user\'s bands share the exact same name', () => {
    const bands = [
      band({ id: 'a', name: 'The Demo Band', slug: 'demo-band' }),
      band({ id: 'b', name: 'The Demo Band', slug: 'demo-band-8f3a' }),
    ];
    expect(bandOptionLabel(bands[0]!, bands)).toBe('The Demo Band (demo-band)');
    expect(bandOptionLabel(bands[1]!, bands)).toBe('The Demo Band (demo-band-8f3a)');
  });

  it('is case-sensitive — "Band" and "band" are not treated as a collision', () => {
    const bands = [band({ id: 'a', name: 'Band' }), band({ id: 'b', name: 'band', slug: 'band-2' })];
    expect(bandOptionLabel(bands[0]!, bands)).toBe('Band');
    expect(bandOptionLabel(bands[1]!, bands)).toBe('band');
  });
});
