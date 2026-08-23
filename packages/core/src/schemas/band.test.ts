// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { bandRoleSchema, createBandInputSchema, renameBandInputSchema } from './band';

describe('bandRoleSchema', () => {
  it('accepts owner|admin|member', () => {
    for (const role of ['owner', 'admin', 'member']) {
      expect(() => bandRoleSchema.parse(role)).not.toThrow();
    }
  });

  it('rejects an unknown role', () => {
    expect(() => bandRoleSchema.parse('superadmin')).toThrow();
  });
});

describe('createBandInputSchema / renameBandInputSchema', () => {
  it('accepts a non-empty name', () => {
    expect(createBandInputSchema.parse({ name: 'The Demo Band' })).toEqual({
      name: 'The Demo Band',
    });
  });

  it('rejects an empty name', () => {
    expect(() => createBandInputSchema.parse({ name: '' })).toThrow();
  });

  it('rejects extra fields', () => {
    expect(() => renameBandInputSchema.parse({ name: 'x', slug: 'y' })).toThrow();
  });
});
