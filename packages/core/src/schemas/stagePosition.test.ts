// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { createInitialStagePosition, stagePositionSchema } from './stagePosition';

describe('stagePositionSchema', () => {
  it('accepts a valid position', () => {
    expect(() => stagePositionSchema.parse({ anchorId: 'a1', fraction: 0.5 })).not.toThrow();
  });

  it('rejects a fraction outside [0, 1]', () => {
    expect(() => stagePositionSchema.parse({ anchorId: 'a1', fraction: 1.5 })).toThrow();
    expect(() => stagePositionSchema.parse({ anchorId: 'a1', fraction: -0.1 })).toThrow();
  });

  it('accepts the boundary fractions 0 and 1', () => {
    expect(() => stagePositionSchema.parse({ anchorId: 'a1', fraction: 0 })).not.toThrow();
    expect(() => stagePositionSchema.parse({ anchorId: 'a1', fraction: 1 })).not.toThrow();
  });

  it('rejects a missing anchorId', () => {
    expect(() => stagePositionSchema.parse({ fraction: 0 })).toThrow();
  });
});

describe('createInitialStagePosition', () => {
  it('starts at the given anchor, fraction 0', () => {
    expect(createInitialStagePosition('a1')).toEqual({ anchorId: 'a1', fraction: 0 });
  });

  it('is undefined when there is no anchor to start from', () => {
    expect(createInitialStagePosition()).toBeUndefined();
  });
});
