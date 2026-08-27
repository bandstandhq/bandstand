// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { availabilityAnswerSchema } from './availabilityAnswer';

describe('availabilityAnswerSchema', () => {
  it.each(['yes', 'maybe', 'no'])('accepts %s', (value) => {
    expect(() => availabilityAnswerSchema.parse(value)).not.toThrow();
  });

  it('rejects anything else', () => {
    expect(() => availabilityAnswerSchema.parse('maybe not')).toThrow();
    expect(() => availabilityAnswerSchema.parse('')).toThrow();
  });
});
