// SPDX-License-Identifier: Apache-2.0

// Matches @bandstand/core's RedeemInviteErrorCode — kept as a plain string
// list here rather than importing the type, since this only decides which
// of a fixed set of i18n keys to show for POST /invites/redeem's `error`.
const KNOWN_ERROR_CODES = ['unknown_code', 'expired', 'revoked', 'redeemed', 'already_member'];

/**
 * Maps a redeemInvite() rejection's message (the server's stable error
 * code, not a sentence — see apps/server/src/routes/invites.ts's redeem
 * handler) to the i18n key for its specific, localized message.
 */
export function joinBandErrorKey(message: string): string {
  return KNOWN_ERROR_CODES.includes(message) ? `joinBand.error.${message}` : 'joinBand.error.generic';
}
