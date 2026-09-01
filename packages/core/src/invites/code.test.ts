// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  generateInviteCode,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
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
  it('generates an 8-character code from the confusion-resistant alphabet', () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(8);
    expect(code).toHaveLength(INVITE_CODE_LENGTH);
    expect([...code].every((char) => INVITE_CODE_ALPHABET.includes(char))).toBe(true);
  });

  it('generates different codes across calls (not deterministic)', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateInviteCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('normalizeInviteCode', () => {
  it('uppercases and trims', () => {
    expect(normalizeInviteCode(' ab3d9zkm ')).toBe('AB3D9ZKM');
  });

  it('strips whitespace anywhere, not just leading/trailing', () => {
    expect(normalizeInviteCode('ab3 d9zkm')).toBe('AB3D9ZKM');
    expect(normalizeInviteCode('a b 3 d 9 z k m')).toBe('AB3D9ZKM');
  });
});

describe('isValidInviteCodeFormat', () => {
  it('accepts a well-formed code regardless of case', () => {
    expect(isValidInviteCodeFormat('ab3d9zkm')).toBe(true);
    expect(isValidInviteCodeFormat('AB3D9ZKM')).toBe(true);
  });

  it('accepts a code with stray internal whitespace', () => {
    expect(isValidInviteCodeFormat('AB3 D9ZKM')).toBe(true);
    expect(isValidInviteCodeFormat(' AB3D9ZKM ')).toBe(true);
  });

  it('rejects the wrong length', () => {
    expect(isValidInviteCodeFormat('AB3D9ZK')).toBe(false);
    expect(isValidInviteCodeFormat('AB3D9ZKMM')).toBe(false);
  });

  it('rejects excluded/unknown characters', () => {
    expect(isValidInviteCodeFormat('AB3D9ZKO')).toBe(false); // O excluded
    expect(isValidInviteCodeFormat('AB3D9ZK1')).toBe(false); // 1 excluded
    expect(isValidInviteCodeFormat('AB3D9ZK!')).toBe(false); // not alphanumeric
  });
});
