// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { anchorSchema } from './anchor';

describe('anchorSchema', () => {
  it('accepts a minimal anchor (no bar/timeMs)', () => {
    expect(() => anchorSchema.parse({ id: 'a1', label: 'Intro', order: 0 })).not.toThrow();
  });

  it('accepts bar and timeMs together', () => {
    expect(() =>
      anchorSchema.parse({ id: 'a1', label: 'Solo', order: 2, bar: 33, timeMs: 45000 }),
    ).not.toThrow();
  });

  it('rejects an empty label', () => {
    expect(() => anchorSchema.parse({ id: 'a1', label: '', order: 0 })).toThrow();
  });

  it('rejects a negative order', () => {
    expect(() => anchorSchema.parse({ id: 'a1', label: 'Intro', order: -1 })).toThrow();
  });

  it('rejects a bar outside 1-9999', () => {
    expect(() => anchorSchema.parse({ id: 'a1', label: 'Intro', order: 0, bar: 0 })).toThrow();
    expect(() => anchorSchema.parse({ id: 'a1', label: 'Intro', order: 0, bar: 10000 })).toThrow();
  });
});
