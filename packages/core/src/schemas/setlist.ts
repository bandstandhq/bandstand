// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

export const setlistSchema = z.object({
  name: z.string().min(1),
  eventDate: z.iso.date().optional(),
  updatedAt: z.number().int().nonnegative(),
});

export type Setlist = z.infer<typeof setlistSchema>;
