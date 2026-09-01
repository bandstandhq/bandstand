// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { compareMembersByRoleThenName, hasAtLeastRole } from './roles';

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

describe('compareMembersByRoleThenName', () => {
  it('sorts owner before admin before member, regardless of input order', () => {
    const members = [
      { role: 'member' as const, name: 'Zed' },
      { role: 'owner' as const, name: 'Alice' },
      { role: 'admin' as const, name: 'Mallory' },
    ];
    expect(members.sort(compareMembersByRoleThenName).map((m) => m.role)).toEqual(['owner', 'admin', 'member']);
  });

  it('breaks ties within the same role alphabetically by name, case-insensitively', () => {
    const members = [
      { role: 'member' as const, name: 'carol' },
      { role: 'member' as const, name: 'Bob' },
      { role: 'member' as const, name: 'Alice' },
    ];
    expect(members.sort(compareMembersByRoleThenName).map((m) => m.name)).toEqual(['Alice', 'Bob', 'carol']);
  });
});
