// SPDX-License-Identifier: Apache-2.0
import type { Invite } from '../schemas/invite';

export type InviteStatus = 'open' | 'redeemed' | 'revoked' | 'expired';

export function getInviteStatus(invite: Invite, now: Date = new Date()): InviteStatus {
  if (invite.revokedAt) return 'revoked';
  if (invite.redeemedAt) return 'redeemed';
  if (new Date(invite.expiresAt) <= now) return 'expired';
  return 'open';
}

/**
 * Every distinct reason POST /invites/redeem can fail with — returned as
 * `{ error: <code> }` (not a free-text message) specifically so the client
 * can show its own localized, per-case message rather than displaying a
 * server-authored English sentence. Shares its non-membership vocabulary
 * with InviteStatus rather than inventing near-duplicate names.
 */
export type RedeemInviteErrorCode = 'unknown_code' | 'expired' | 'revoked' | 'redeemed' | 'already_member';
