// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

// What the server actually sends as a push message's JSON payload — read
// by the service worker (apps/web/src/sw.ts) to build the Notification,
// and by push/send.ts (server) to build it. `url` is where a click should
// land, e.g. `/bands/:bandId/calendar/:occurrenceId` or
// `/bands/:bandId/polls/:pollId` — always an app-relative path, since the
// service worker resolves it against its own origin.
export const pushPayloadSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  url: z.string().min(1),
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;
