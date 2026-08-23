// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { stageAwarenessSchema } from './stageAwareness';

const valid = {
  userId: 'user-1',
  setlistId: 'setlist-1',
  itemId: 'item-1',
  position: { sectionIndex: 0, fraction: 0 },
  liveTranspose: 0,
  isLeaderCandidate: true,
};

describe('stageAwarenessSchema', () => {
  it('accepts a valid state', () => {
    expect(() => stageAwarenessSchema.parse(valid)).not.toThrow();
  });

  it('accepts a negative liveTranspose (down-transposition)', () => {
    expect(() => stageAwarenessSchema.parse({ ...valid, liveTranspose: -4 })).not.toThrow();
  });

  it('rejects an invalid nested position', () => {
    expect(() => stageAwarenessSchema.parse({ ...valid, position: { sectionIndex: 0, fraction: 2 } })).toThrow();
  });

  it('rejects a missing userId', () => {
    const { userId: _userId, ...rest } = valid;
    expect(() => stageAwarenessSchema.parse(rest)).toThrow();
  });
});
