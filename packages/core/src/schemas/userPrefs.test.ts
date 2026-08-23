// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { DEFAULT_USER_PREFS, updateUserPrefsInputSchema, userPrefsSchema } from './userPrefs';

describe('userPrefsSchema', () => {
  it('accepts the documented defaults', () => {
    expect(() => userPrefsSchema.parse(DEFAULT_USER_PREFS)).not.toThrow();
  });

  it('rejects an unknown textSize', () => {
    expect(() => userPrefsSchema.parse({ ...DEFAULT_USER_PREFS, textSize: 'huge' })).toThrow();
  });

  it('rejects an unknown theme', () => {
    expect(() => userPrefsSchema.parse({ ...DEFAULT_USER_PREFS, theme: 'sepia' })).toThrow();
  });

  it('accepts a negative personalTranspose (down-transposition)', () => {
    expect(() => userPrefsSchema.parse({ ...DEFAULT_USER_PREFS, personalTranspose: -3 })).not.toThrow();
  });

  it('rejects an unknown setlistViewMode', () => {
    expect(() => userPrefsSchema.parse({ ...DEFAULT_USER_PREFS, setlistViewMode: 'grid' })).toThrow();
  });

  it('accepts board as a setlistViewMode', () => {
    expect(() => userPrefsSchema.parse({ ...DEFAULT_USER_PREFS, setlistViewMode: 'board' })).not.toThrow();
  });
});

describe('updateUserPrefsInputSchema', () => {
  it('accepts a partial patch', () => {
    expect(() => updateUserPrefsInputSchema.parse({ personalTranspose: 2 })).not.toThrow();
  });

  it('accepts an empty patch', () => {
    expect(() => updateUserPrefsInputSchema.parse({})).not.toThrow();
  });
});
