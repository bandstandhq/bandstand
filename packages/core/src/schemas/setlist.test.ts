// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { setlistSchema } from './setlist';

describe('setlistSchema', () => {
  it('accepts a missing eventDate', () => {
    expect(() => setlistSchema.parse({ name: 'Summer Gig', updatedAt: 0 })).not.toThrow();
  });

  it('accepts a valid ISO date for eventDate', () => {
    expect(() =>
      setlistSchema.parse({ name: 'Summer Gig', eventDate: '2026-07-04', updatedAt: 0 }),
    ).not.toThrow();
  });

  it('rejects a malformed eventDate', () => {
    expect(() =>
      setlistSchema.parse({ name: 'Summer Gig', eventDate: 'next friday', updatedAt: 0 }),
    ).toThrow();
  });
});
