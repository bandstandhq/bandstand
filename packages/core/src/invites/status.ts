// SPDX-License-Identifier: Apache-2.0
import type { Invite } from '../schemas/invite';

export type InviteStatus = 'open' | 'redeemed' | 'revoked' | 'expired';

export function getInviteStatus(invite: Invite, now: Date = new Date()): InviteStatus {
  if (invite.revokedAt) return 'revoked';
  if (invite.redeemedAt) return 'redeemed';
  if (new Date(invite.expiresAt) <= now) return 'expired';
  return 'open';
}
