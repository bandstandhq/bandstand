// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

export const bandRoleSchema = z.enum(['owner', 'admin', 'member']);
export type BandRole = z.infer<typeof bandRoleSchema>;

export const createBandInputSchema = z.strictObject({ name: z.string().min(1) });
export type CreateBandInput = z.infer<typeof createBandInputSchema>;

export const renameBandInputSchema = z.strictObject({ name: z.string().min(1) });
export type RenameBandInput = z.infer<typeof renameBandInputSchema>;

export const bandSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});
export type Band = z.infer<typeof bandSchema>;

export const bandMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: bandRoleSchema,
  instruments: z.array(z.string()),
});
export type BandMember = z.infer<typeof bandMemberSchema>;

// Owner is deliberately excluded — becoming (or ceasing to be) "the" owner
// only ever happens through the transfer-ownership endpoint, which is what
// keeps "a band has exactly one owner" meaningful.
export const changeMemberRoleInputSchema = z.strictObject({
  role: z.enum(['admin', 'member']),
});
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleInputSchema>;

export const updateMyInstrumentsInputSchema = z.strictObject({
  instruments: z.array(z.string().min(1)),
});
export type UpdateMyInstrumentsInput = z.infer<typeof updateMyInstrumentsInputSchema>;
