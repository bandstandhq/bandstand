// SPDX-License-Identifier: Apache-2.0
//
// Owner > admin > member rank, shared by apps/server (bandAuthz.ts's
// requireBandRole) and apps/web (RequireBandRole) so both agree on what
// "at least admin" means without either redefining the ladder itself.
import type { BandRole } from '../schemas/band';

const ROLE_RANK: Record<BandRole, number> = { member: 1, admin: 2, owner: 3 };

/** Whether `role` is at least as senior as `minRole` on the owner > admin > member ladder. */
export function hasAtLeastRole(role: BandRole, minRole: BandRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}
