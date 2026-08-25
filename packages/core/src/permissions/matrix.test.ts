// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { BandRole } from '../schemas/band';
import { ACTIONS, can, canRemoveMember, type Action } from './matrix';

// One row per docs/PERMISSIONS.md matrix line: [action, owner, admin, member].
const MATRIX: [Action, boolean, boolean, boolean][] = [
  ['band:rename', true, true, false],
  ['band:delete', true, false, false],
  ['band:transferOwnership', true, false, false],
  ['member:changeRole', true, false, false],
  ['member:remove', true, true, false],
  ['band:leave', true, true, true],
  ['invite:create', true, true, false],
  ['invite:revoke', true, true, false],
  ['song:create', true, true, true],
  ['song:edit', true, true, true],
  ['song:archive', true, true, true],
  ['song:restore', true, true, true],
  ['song:deleteForever', true, true, false],
  ['idea:vote', true, true, true],
  ['idea:resolveTie', true, true, false],
  ['setlist:create', true, true, true],
  ['setlist:edit', true, true, true],
  ['setlist:delete', true, true, false],
  ['selfPrefs:edit', true, true, true],
  ['file:upload', true, true, true],
  ['file:detach', true, true, false],
];

const ROLES: BandRole[] = ['owner', 'admin', 'member'];

describe('can', () => {
  it.each(MATRIX)('%s — owner:%s admin:%s member:%s', (action, owner, admin, member) => {
    const expected: Record<BandRole, boolean> = { owner, admin, member };
    for (const role of ROLES) {
      expect(can(role, action)).toBe(expected[role]);
    }
  });

  it('covers every Action variant exactly once, matching ACTIONS', () => {
    const covered = MATRIX.map(([action]) => action).sort();
    expect(covered).toEqual([...ACTIONS].sort());
    expect(new Set(covered).size).toBe(covered.length);
  });
});

describe('canRemoveMember', () => {
  it('owner may remove an admin or a member, never "the owner" (itself)', () => {
    expect(canRemoveMember('owner', 'admin')).toBe(true);
    expect(canRemoveMember('owner', 'member')).toBe(true);
    expect(canRemoveMember('owner', 'owner')).toBe(false);
  });

  it('admin may remove a member but never the owner or another admin', () => {
    expect(canRemoveMember('admin', 'member')).toBe(true);
    expect(canRemoveMember('admin', 'admin')).toBe(false);
    expect(canRemoveMember('admin', 'owner')).toBe(false);
  });

  it('member may never remove anyone', () => {
    expect(canRemoveMember('member', 'owner')).toBe(false);
    expect(canRemoveMember('member', 'admin')).toBe(false);
    expect(canRemoveMember('member', 'member')).toBe(false);
  });
});
