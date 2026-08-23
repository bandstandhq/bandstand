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
