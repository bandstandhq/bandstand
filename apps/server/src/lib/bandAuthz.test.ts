// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { hasAtLeastRole } from './bandAuthz';

describe('hasAtLeastRole', () => {
  it('owner satisfies every minimum role', () => {
    expect(hasAtLeastRole('owner', 'owner')).toBe(true);
    expect(hasAtLeastRole('owner', 'admin')).toBe(true);
    expect(hasAtLeastRole('owner', 'member')).toBe(true);
  });

  it('admin satisfies admin/member but not owner', () => {
    expect(hasAtLeastRole('admin', 'admin')).toBe(true);
    expect(hasAtLeastRole('admin', 'member')).toBe(true);
    expect(hasAtLeastRole('admin', 'owner')).toBe(false);
  });

  it('member only satisfies member', () => {
    expect(hasAtLeastRole('member', 'member')).toBe(true);
    expect(hasAtLeastRole('member', 'admin')).toBe(false);
    expect(hasAtLeastRole('member', 'owner')).toBe(false);
  });
});
