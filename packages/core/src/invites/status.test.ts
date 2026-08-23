// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { getInviteStatus } from './status';

const base = {
  id: '1',
  bandId: 'band-1',
  code: 'AB3D9Z',
  label: 'Jamie',
  instrument: null,
  role: 'member' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-01-08T00:00:00.000Z',
  redeemedBy: null,
  redeemedAt: null,
  revokedAt: null,
};

const now = new Date('2026-01-05T00:00:00.000Z');

describe('getInviteStatus', () => {
  it('is open when not redeemed/revoked/expired', () => {
    expect(getInviteStatus(base, now)).toBe('open');
  });

  it('is expired once past expiresAt, even if not redeemed/revoked', () => {
    expect(getInviteStatus(base, new Date('2026-01-09T00:00:00.000Z'))).toBe('expired');
  });

  it('is redeemed when redeemedAt is set, regardless of expiry', () => {
    expect(getInviteStatus({ ...base, redeemedBy: 'user-1', redeemedAt: '2026-01-02T00:00:00.000Z' }, now)).toBe(
      'redeemed',
    );
  });

  it('is revoked when revokedAt is set, even if also expired', () => {
    expect(
      getInviteStatus({ ...base, revokedAt: '2026-01-02T00:00:00.000Z' }, new Date('2026-01-09T00:00:00.000Z')),
    ).toBe('revoked');
  });

  it('prefers revoked over redeemed if somehow both are set', () => {
    expect(
      getInviteStatus(
        { ...base, redeemedBy: 'user-1', redeemedAt: '2026-01-02T00:00:00.000Z', revokedAt: '2026-01-03T00:00:00.000Z' },
        now,
      ),
    ).toBe('revoked');
  });
});
