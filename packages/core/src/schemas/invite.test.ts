// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { createInviteInputSchema, redeemInviteInputSchema } from './invite';

describe('createInviteInputSchema', () => {
  it('accepts a label + role, instrument and expiresInDays optional', () => {
    expect(() => createInviteInputSchema.parse({ label: 'Jamie', role: 'member' })).not.toThrow();
    expect(() =>
      createInviteInputSchema.parse({
        label: 'Jamie',
        instrument: 'bass',
        role: 'admin',
        expiresInDays: 14,
      }),
    ).not.toThrow();
  });

  it('rejects a missing label', () => {
    expect(() => createInviteInputSchema.parse({ role: 'member' })).toThrow();
  });

  it('rejects a non-positive expiresInDays', () => {
    expect(() =>
      createInviteInputSchema.parse({ label: 'Jamie', role: 'member', expiresInDays: 0 }),
    ).toThrow();
  });
});

describe('redeemInviteInputSchema', () => {
  it('accepts a well-formed code, case-insensitively', () => {
    expect(() => redeemInviteInputSchema.parse({ code: 'ab3d9z' })).not.toThrow();
    expect(() => redeemInviteInputSchema.parse({ code: 'AB3D9Z' })).not.toThrow();
  });

  it('rejects a malformed code', () => {
    expect(() => redeemInviteInputSchema.parse({ code: 'AB3D9O' })).toThrow();
    expect(() => redeemInviteInputSchema.parse({ code: 'short' })).toThrow();
  });
});
