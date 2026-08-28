// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { pushTriggersSchema } from './userPrefs';

// Matches the browser's own `PushSubscription.toJSON()` shape.
export const subscribePushInputSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  deviceLabel: z.string().min(1).optional(),
});
export type SubscribePushInput = z.infer<typeof subscribePushInputSchema>;

export const pushPrefInputSchema = z.object({
  trigger: pushTriggersSchema.keyof(),
  enabled: z.boolean(),
});
export type PushPrefInput = z.infer<typeof pushPrefInputSchema>;
