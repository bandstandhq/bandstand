// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { isValidInviteCodeFormat } from '../invites/code';
import { bandRoleSchema } from './band';

export const createInviteInputSchema = z.strictObject({
  // A free-form note for the creator's own reference (shown in the UI as
  // "Note", e.g. "who is this code for?") — not the joining person's
  // display name, which comes from their own account at redemption time.
  label: z.string().min(1),
  instrument: z.string().min(1).optional(),
  role: bandRoleSchema,
  // Defaults to 7 days server-side when omitted.
  expiresInDays: z.number().int().positive().optional(),
});
export type CreateInviteInput = z.infer<typeof createInviteInputSchema>;

export const inviteSchema = z.object({
  id: z.string(),
  bandId: z.string(),
  code: z.string(),
  label: z.string(),
  instrument: z.string().nullable(),
  role: bandRoleSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  redeemedBy: z.string().nullable(),
  redeemedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
});
export type Invite = z.infer<typeof inviteSchema>;

export const redeemInviteInputSchema = z.strictObject({
  code: z.string().refine(isValidInviteCodeFormat, 'must be a valid 6-character invite code'),
});
export type RedeemInviteInput = z.infer<typeof redeemInviteInputSchema>;
