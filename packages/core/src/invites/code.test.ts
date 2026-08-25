// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  generateInviteCode,
  INVITE_CODE_ALPHABET,
  isValidInviteCodeFormat,
  normalizeInviteCode,
} from './code';

describe('INVITE_CODE_ALPHABET', () => {
  it('excludes confusable characters', () => {
    for (const char of ['0', 'O', '1', 'I', 'l']) {
      expect(INVITE_CODE_ALPHABET).not.toContain(char);
    }
  });

  it('has exactly 32 characters, so byte % length is unbiased', () => {
    expect(INVITE_CODE_ALPHABET.length).toBe(32);
    expect(new Set(INVITE_CODE_ALPHABET).size).toBe(32);
  });
});

describe('generateInviteCode', () => {
  it('generates a 6-character code from the confusion-resistant alphabet', () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(6);
    expect([...code].every((char) => INVITE_CODE_ALPHABET.includes(char))).toBe(true);
  });

  it('generates different codes across calls (not deterministic)', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateInviteCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('normalizeInviteCode', () => {
  it('uppercases and trims', () => {
    expect(normalizeInviteCode(' ab3d9z ')).toBe('AB3D9Z');
  });

  it('strips whitespace anywhere, not just leading/trailing', () => {
    expect(normalizeInviteCode('ab3 d9z')).toBe('AB3D9Z');
    expect(normalizeInviteCode('a b 3 d 9 z')).toBe('AB3D9Z');
  });
});

describe('isValidInviteCodeFormat', () => {
  it('accepts a well-formed code regardless of case', () => {
    expect(isValidInviteCodeFormat('ab3d9z')).toBe(true);
    expect(isValidInviteCodeFormat('AB3D9Z')).toBe(true);
  });

  it('accepts a code with stray internal whitespace', () => {
    expect(isValidInviteCodeFormat('AB3 D9Z')).toBe(true);
    expect(isValidInviteCodeFormat(' AB3D9Z ')).toBe(true);
  });

  it('rejects the wrong length', () => {
    expect(isValidInviteCodeFormat('AB3D9')).toBe(false);
    expect(isValidInviteCodeFormat('AB3D9ZZ')).toBe(false);
  });

  it('rejects excluded/unknown characters', () => {
    expect(isValidInviteCodeFormat('AB3D9O')).toBe(false); // O excluded
    expect(isValidInviteCodeFormat('AB3D91')).toBe(false); // 1 excluded
    expect(isValidInviteCodeFormat('AB3D9!')).toBe(false); // not alphanumeric
  });
});
