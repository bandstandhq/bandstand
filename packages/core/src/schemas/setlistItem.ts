// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { musicalKeySchema } from './song';

const songItemSchema = z.strictObject({
  id: z.string(),
  type: z.literal('song'),
  songId: z.string(),
  overrideKey: musicalKeySchema.optional(),
});

const breakItemSchema = z.strictObject({
  id: z.string(),
  type: z.literal('break'),
  breakMinutes: z.number().int().positive(),
});

const finaleItemSchema = z.strictObject({
  id: z.string(),
  type: z.literal('finale'),
});

export const setlistItemSchema = z.discriminatedUnion('type', [
  songItemSchema,
  breakItemSchema,
  finaleItemSchema,
]);

export type SetlistItem = z.infer<typeof setlistItemSchema>;
