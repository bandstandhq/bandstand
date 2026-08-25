// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  bandRoleSchema,
  changeMemberRoleInputSchema,
  createBandInputSchema,
  renameBandInputSchema,
  updateMyInstrumentsInputSchema,
} from './band';

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

describe('changeMemberRoleInputSchema', () => {
  it('accepts admin or member', () => {
    expect(changeMemberRoleInputSchema.parse({ role: 'admin' })).toEqual({ role: 'admin' });
    expect(changeMemberRoleInputSchema.parse({ role: 'member' })).toEqual({ role: 'member' });
  });

  it('rejects owner — that only ever happens via transfer-ownership', () => {
    expect(() => changeMemberRoleInputSchema.parse({ role: 'owner' })).toThrow();
  });
});

describe('updateMyInstrumentsInputSchema', () => {
  it('accepts a list of instrument strings', () => {
    expect(updateMyInstrumentsInputSchema.parse({ instruments: ['Guitar', 'Vocals'] })).toEqual({
      instruments: ['Guitar', 'Vocals'],
    });
  });

  it('accepts an empty list', () => {
    expect(updateMyInstrumentsInputSchema.parse({ instruments: [] })).toEqual({ instruments: [] });
  });

  it('rejects an empty-string instrument', () => {
    expect(() => updateMyInstrumentsInputSchema.parse({ instruments: [''] })).toThrow();
  });
});
