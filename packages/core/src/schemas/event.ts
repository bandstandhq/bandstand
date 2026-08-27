// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

// A gig, rehearsal, or other band date — lives in the band's shared Yjs doc
// (`events` Y.Map, keyed by eventId, same "map key is the id" convention as
// `setlistSchema`) so it's collaboratively editable and offline-readable,
// same as songs and setlists. See docs/adr/0011-calendar-events.md.
//
// Exported as `CalendarEvent`/`calendarEventSchema`, not `Event` — the
// bare name would shadow the DOM's global `Event` type wherever this is
// imported in apps/web. The Yjs map itself is still named plain `events`,
// matching the spec.

export const eventTypeSchema = z.enum(['gig', 'rehearsal', 'other']);
export type EventType = z.infer<typeof eventTypeSchema>;

export const eventStatusSchema = z.enum(['confirmed', 'tentative', 'cancelled']);
export type EventStatus = z.infer<typeof eventStatusSchema>;

/**
 * A recurrence rule — present only on the one `events` entry that defines a
 * series (`seriesId` equal to its own key). Occurrences are resolved from
 * this at read time (`resolveEventOccurrences`, added in a later step), never
 * materialized as one entry per date. See docs/adr/0011-calendar-events.md
 * for why, and for the hard expansion cap a `until`-less rule still needs.
 */
export const seriesRuleSchema = z.object({
  freq: z.enum(['weekly', 'biweekly', 'monthly']),
  until: z.iso.date().optional(),
});
export type SeriesRule = z.infer<typeof seriesRuleSchema>;

/** Hand-entered, optional — there is no geocode-on-type lookup (see the ADR). When present, takes precedence over `location`'s text for building a maps link. */
export const locationGeoSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LocationGeo = z.infer<typeof locationGeoSchema>;

export const calendarEventSchema = z.object({
  type: eventTypeSchema,
  title: z.string().min(1),
  // Epoch milliseconds, same convention as `setlistSchema.updatedAt` — not a
  // date-only string, since a gig/rehearsal has a time of day even when
  // `allDay` is false. `occurrenceDate` below is the date-only field, used
  // only to identify which generated day an exception overrides.
  startsAt: z.number().int().nonnegative(),
  endsAt: z.number().int().nonnegative().optional(),
  allDay: z.boolean(),
  location: z.string().optional(),
  locationGeo: locationGeoSchema.optional(),
  notes: z.string().optional(),
  setlistId: z.string().optional(),
  status: eventStatusSchema,
  // Groups every occurrence (the template plus any exceptions) of one
  // series. Absent on a plain, non-recurring event.
  seriesId: z.string().optional(),
  // Present only on the series' template entry (`seriesId === own key`).
  seriesRule: seriesRuleSchema.optional(),
  // Present only on an exception entry — the generated date (from the
  // template's `seriesRule`) that this entry overrides or cancels.
  occurrenceDate: z.iso.date().optional(),
});

export type CalendarEvent = z.infer<typeof calendarEventSchema>;
