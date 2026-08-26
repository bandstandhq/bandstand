// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { stageAwarenessSchema } from './stageAwareness';
import { stagePositionSchema } from './stagePosition';

const valid = {
  userId: 'user-1',
  setlistId: 'setlist-1',
  itemId: 'item-1',
  position: { anchorId: 'a1', fraction: 0 },
  liveTranspose: 0,
  isLeaderCandidate: true,
};

describe('stageAwarenessSchema', () => {
  it('accepts a valid state', () => {
    expect(() => stageAwarenessSchema.parse(valid)).not.toThrow();
  });

  it('accepts a missing position — the "song only" and "offline" fallback levels never send one', () => {
    const { position: _position, ...rest } = valid;
    expect(() => stageAwarenessSchema.parse(rest)).not.toThrow();
  });

  it('accepts a negative liveTranspose (down-transposition)', () => {
    expect(() => stageAwarenessSchema.parse({ ...valid, liveTranspose: -4 })).not.toThrow();
  });

  it('rejects an invalid nested position', () => {
    expect(() => stageAwarenessSchema.parse({ ...valid, position: { anchorId: 'a1', fraction: 2 } })).toThrow();
  });

  it('rejects a missing userId', () => {
    const { userId: _userId, ...rest } = valid;
    expect(() => stageAwarenessSchema.parse(rest)).toThrow();
  });

  it('never carries a field describing a visual position (page number, scroll pixels, coordinates) — see docs/adr/0010-anchor-sync.md', () => {
    // Structural, not a runtime-instance check: every field name in both
    // schemas, at every nesting level, is checked against a denylist of
    // words that would mean "this is a rendering coordinate, not a
    // logical anchor." A page-sync fallback rides a synthetic anchor id
    // through `position.anchorId` instead — see stageAwareness.ts.
    const forbidden = /page|pixel|scroll|coord|^top$|^left$|^x$|^y$/i;
    const fieldNames = [...Object.keys(stageAwarenessSchema.shape), ...Object.keys(stagePositionSchema.shape)];
    for (const name of fieldNames) {
      expect(name).not.toMatch(forbidden);
    }
  });
});
