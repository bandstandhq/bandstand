// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { COMMON_INSTRUMENTS } from './instruments';

describe('COMMON_INSTRUMENTS', () => {
  it('has no duplicates or empty entries', () => {
    expect(new Set(COMMON_INSTRUMENTS).size).toBe(COMMON_INSTRUMENTS.length);
    expect(COMMON_INSTRUMENTS.every((i) => i.trim().length > 0)).toBe(true);
  });
});
