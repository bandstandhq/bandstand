// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { createInitialStagePosition, stagePositionSchema } from './stagePosition';

describe('stagePositionSchema', () => {
  it('accepts a valid position', () => {
    expect(() => stagePositionSchema.parse({ sectionIndex: 2, fraction: 0.5 })).not.toThrow();
  });

  it('rejects a negative sectionIndex', () => {
    expect(() => stagePositionSchema.parse({ sectionIndex: -1, fraction: 0 })).toThrow();
  });

  it('rejects a fraction outside [0, 1]', () => {
    expect(() => stagePositionSchema.parse({ sectionIndex: 0, fraction: 1.5 })).toThrow();
    expect(() => stagePositionSchema.parse({ sectionIndex: 0, fraction: -0.1 })).toThrow();
  });

  it('accepts the boundary fractions 0 and 1', () => {
    expect(() => stagePositionSchema.parse({ sectionIndex: 0, fraction: 0 })).not.toThrow();
    expect(() => stagePositionSchema.parse({ sectionIndex: 0, fraction: 1 })).not.toThrow();
  });
});

describe('createInitialStagePosition', () => {
  it('starts at the very beginning', () => {
    expect(createInitialStagePosition()).toEqual({ sectionIndex: 0, fraction: 0 });
  });
});
