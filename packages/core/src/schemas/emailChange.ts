// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

// confirmUrl/cancelUrl are supplied by the client (built from
// window.location.origin, same pattern as ForgotPassword.tsx's redirectTo)
// rather than the server guessing its own web origin — self-hosting-
// friendly, and consistent with the client owning "which server/origin am
// I" (see docs/adr/0001). The server still validates both origins against
// its own WEB_ORIGIN allow-list before ever emailing them out (see
// routes/emailChange.ts) — accepting an arbitrary redirect target here
// would let a compromised session point the old-address notice email's
// cancel link at a phishing domain, abusing Bandstand's own legitimate
// sender as bait.
export const requestEmailChangeInputSchema = z.strictObject({
  newEmail: z.email(),
  confirmUrl: z.url(),
  cancelUrl: z.url(),
});
export type RequestEmailChangeInput = z.infer<typeof requestEmailChangeInputSchema>;

export const confirmEmailChangeInputSchema = z.strictObject({
  token: z.string().min(1),
});
export type ConfirmEmailChangeInput = z.infer<typeof confirmEmailChangeInputSchema>;

export const cancelEmailChangeInputSchema = z.strictObject({
  token: z.string().min(1),
});
export type CancelEmailChangeInput = z.infer<typeof cancelEmailChangeInputSchema>;
