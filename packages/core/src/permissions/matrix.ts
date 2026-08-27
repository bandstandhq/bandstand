// SPDX-License-Identifier: Apache-2.0
//
// The single source of truth for docs/PERMISSIONS.md's role matrix. Both
// apps/server (actual enforcement) and apps/web (hiding actions the caller's
// role doesn't allow) call `can`/`canRemoveMember` rather than each encoding
// the matrix in their own words — see docs/adr/0005-permissions.md.
import type { BandRole } from '../schemas/band';
import { hasAtLeastRole } from './roles';

export type Action =
  | 'band:rename'
  | 'band:delete'
  | 'band:transferOwnership'
  | 'member:changeRole'
  | 'member:remove'
  | 'band:leave'
  | 'invite:create'
  | 'invite:revoke'
  | 'song:create'
  | 'song:edit'
  | 'song:archive'
  | 'song:restore'
  | 'song:deleteForever'
  | 'idea:vote'
  | 'idea:resolveTie'
  | 'setlist:create'
  | 'setlist:edit'
  | 'setlist:delete'
  | 'selfPrefs:edit'
  | 'file:upload'
  | 'file:detach'
  | 'assignment:editOthers'
  | 'anchor:edit'
  | 'annotation:moderateShared'
  | 'event:create'
  | 'event:edit'
  | 'event:delete'
  | 'poll:create'
  | 'poll:close';

/**
 * The minimum role each action requires — the exact matrix from
 * docs/PERMISSIONS.md, expressed once.
 *
 * Two rows need more than a rank check and are deliberately simplified here:
 * - `band:leave` is `member` (everyone may attempt it); the owner's "transfer
 *   ownership first" precondition is state, not a role check, and is
 *   enforced by the route handler itself, not here.
 * - `member:remove`'s row reflects only "admins may remove *someone*" — the
 *   additional restriction that an admin can't remove the owner or another
 *   admin is `canRemoveMember` below, not expressible as a single minimum role.
 *
 * `assignment:editOthers` has no "self" counterpart here for the same reason
 * `selfPrefs:edit` covers only self-scoped state: a member changing their
 * *own* voice assignment is always allowed, at any role, so it isn't a
 * matrix row at all — only overriding *someone else's* assignment needs a
 * role check.
 *
 * `anchor:edit` covers a song's shared anchor list — see
 * docs/adr/0010-anchor-sync.md. Unlike assignments/instruments/notes, there
 * is no self-scoped variant: anchors are band-wide, not per-member, so every
 * edit goes through this one check.
 *
 * `annotation:moderateShared` gates removing a *shared* annotation layer
 * someone else published — same shape as `file:detach`. Removing one's own
 * (personal, or previously shared by oneself) needs no matrix entry, same
 * self-always-allowed pattern as `assignment:editOthers`.
 *
 * `event:create`/`event:edit`/`event:delete` and `poll:create`/`poll:close`
 * cover calendar events and scheduling polls (docs/adr/0011-calendar-events.md).
 * Responding to your own availability or voting on your own behalf in a poll
 * has no matrix entry at all, same self-always-allowed pattern as
 * `assignment:editOthers` — but unlike that case, "always for yourself, never
 * someone else's" is enforced at the CRDT layer (a hocuspocus onChange guard
 * keyed by userId), not just left unchecked, since there's no REST route in
 * front of these live doc edits to gate it otherwise.
 */
const MIN_ROLE: Record<Action, BandRole> = {
  'band:rename': 'admin',
  'band:delete': 'owner',
  'band:transferOwnership': 'owner',
  'member:changeRole': 'owner',
  'member:remove': 'admin',
  'band:leave': 'member',
  'invite:create': 'admin',
  'invite:revoke': 'admin',
  'song:create': 'member',
  'song:edit': 'member',
  'song:archive': 'member',
  'song:restore': 'member',
  'song:deleteForever': 'admin',
  'idea:vote': 'member',
  'idea:resolveTie': 'admin',
  'setlist:create': 'member',
  'setlist:edit': 'member',
  'setlist:delete': 'admin',
  'selfPrefs:edit': 'member',
  'file:upload': 'member',
  'file:detach': 'admin',
  'assignment:editOthers': 'admin',
  'anchor:edit': 'admin',
  'annotation:moderateShared': 'admin',
  'event:create': 'admin',
  'event:edit': 'admin',
  'event:delete': 'admin',
  'poll:create': 'admin',
  'poll:close': 'admin',
};

/** Every action the matrix covers, derived from `MIN_ROLE` so there's exactly one list. */
export const ACTIONS = Object.keys(MIN_ROLE) as Action[];

export function can(role: BandRole, action: Action): boolean {
  return hasAtLeastRole(role, MIN_ROLE[action]);
}

/**
 * "Remove a member" (docs/PERMISSIONS.md, footnote 1): the owner may remove
 * any admin or member (never "the owner" — there is only ever one, and
 * that's always the actor themselves; self-removal goes through `band:leave`
 * instead). An admin may remove a member but never the owner or another admin.
 */
export function canRemoveMember(actorRole: BandRole, targetRole: BandRole): boolean {
  if (actorRole === 'owner') return targetRole !== 'owner';
  if (actorRole === 'admin') return targetRole === 'member';
  return false;
}
