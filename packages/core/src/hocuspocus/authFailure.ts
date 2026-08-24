// SPDX-License-Identifier: Apache-2.0
//
// Shared between apps/server's onAuthenticate (which throws an error
// carrying one of these as `.reason`) and apps/web's provider.on
// ('authenticationFailed') handler (which reads it back) — see
// docs/adr/0006-offline-cache-scoping.md for why the distinction matters:
// only 'not-a-member' is safe to treat as "wipe this device's local cache".
export const HOCUSPOCUS_AUTH_FAILURE_REASON = {
  /** No valid session/token at all — not a membership judgement. */
  unauthorized: 'unauthorized',
  /** A valid session, but the user isn't (or no longer is) a band member. */
  notAMember: 'not-a-member',
} as const;

export type HocuspocusAuthFailureReason =
  (typeof HOCUSPOCUS_AUTH_FAILURE_REASON)[keyof typeof HOCUSPOCUS_AUTH_FAILURE_REASON];
