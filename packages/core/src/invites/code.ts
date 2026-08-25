// SPDX-License-Identifier: Apache-2.0
//
// Confusion-resistant alphabet excluding 0/O, 1/I/l (uppercase-only output
// makes lowercase "l" moot, but the exclusion is spelled out for clarity).
// 32 characters exactly — 256 % 32 === 0, so mapping a random byte to an
// alphabet index via `byte % 32` is perfectly uniform, no rejection
// sampling needed.
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 6;

/** Generates a random 6-character invite code from the confusion-resistant alphabet. */
export function generateInviteCode(): string {
  const bytes = new Uint8Array(INVITE_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) {
    code += INVITE_CODE_ALPHABET[byte % INVITE_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Redemption is case-insensitive and ignores whitespace (a code relayed by
 * hand — read aloud, split across a text message — often picks up stray or
 * mid-string spaces), so normalize before comparing/looking up.
 */
export function normalizeInviteCode(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase();
}

/** True if `code` has the right shape to even attempt redemption (cheap pre-check, not a lookup). */
export function isValidInviteCodeFormat(code: string): boolean {
  const normalized = normalizeInviteCode(code);
  if (normalized.length !== INVITE_CODE_LENGTH) return false;
  return [...normalized].every((char) => INVITE_CODE_ALPHABET.includes(char));
}
