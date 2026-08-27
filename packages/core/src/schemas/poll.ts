// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

// A scheduling poll — several candidate dates/times, band members vote on
// each. Lives in the band's shared Yjs doc (`polls` Y.Map, keyed by pollId,
// same "map key is the id" convention as `setlistSchema`). See
// docs/adr/0011-calendar-events.md.

export const pollOptionSchema = z.object({
  // Array element, so (unlike the poll/event maps themselves) it needs its
  // own id — same reasoning as `anchorSchema`/`setlistItemSchema`.
  id: z.string(),
  startsAt: z.number().int().nonnegative(),
  endsAt: z.number().int().nonnegative().optional(),
});
export type PollOption = z.infer<typeof pollOptionSchema>;

export const pollSchema = z.object({
  title: z.string().min(1),
  notes: z.string().optional(),
  options: z.array(pollOptionSchema).min(1),
  closesAt: z.number().int().nonnegative().optional(),
  // Set once an admin closes the poll into a real event (see
  // `poll:close` in the permissions matrix) — the poll then shows itself as
  // closed, linking to the event it resolved into.
  resolvedEventId: z.string().optional(),
});

export type Poll = z.infer<typeof pollSchema>;

/** Body of `POST /bands/:bandId/polls/:pollId/close` — which option wins, becoming the real event the poll resolves into. */
export const closePollInputSchema = z.strictObject({
  optionId: z.string().min(1),
  title: z.string().min(1),
  type: z.enum(['gig', 'rehearsal', 'other']),
  location: z.string().optional(),
  notes: z.string().optional(),
});
export type ClosePollInput = z.infer<typeof closePollInputSchema>;
