// SPDX-License-Identifier: Apache-2.0
//
// Pure Y.Doc mutations/reads for the `events` map and its `availability`
// answers — see docs/adr/0011-calendar-events.md. Recurring-series
// resolution (turning a template + exceptions into concrete occurrences)
// lives in eventSeries.ts, since it never touches the doc.
import * as Y from 'yjs';
import { type AvailabilityAnswer } from '../schemas/availabilityAnswer';
import { type CalendarEvent, calendarEventSchema, type SeriesRule } from '../schemas/event';

type NewEventInput = Omit<CalendarEvent, 'seriesId' | 'seriesRule' | 'occurrenceDate' | 'createdAt'>;

function getEventOrThrow(doc: Y.Doc, eventId: string): CalendarEvent {
  const existing = doc.getMap('events').get(eventId) as CalendarEvent | undefined;
  if (!existing) throw new Error(`Event not found: ${eventId}`);
  return existing;
}

export function listEvents(doc: Y.Doc): Record<string, CalendarEvent> {
  return doc.getMap('events').toJSON() as Record<string, CalendarEvent>;
}

/** A plain, non-recurring event. */
export function createEvent(doc: Y.Doc, input: NewEventInput): string {
  const id = crypto.randomUUID();
  const event = calendarEventSchema.parse({ ...input, createdAt: Date.now() });
  doc.getMap('events').set(id, event);
  return id;
}

/** The series' template entry — `seriesId` is set to its own generated id, per docs/adr/0011-calendar-events.md. */
export function createRecurringEvent(doc: Y.Doc, input: NewEventInput, seriesRule: SeriesRule): string {
  const id = crypto.randomUUID();
  const event = calendarEventSchema.parse({ ...input, seriesId: id, seriesRule, createdAt: Date.now() });
  doc.getMap('events').set(id, event);
  return id;
}

/**
 * A separate, real `events` entry that overrides (or, with
 * `overrides.status: 'cancelled'`, suppresses) one generated date of a
 * series — never a mutation of the template itself. See
 * `resolveEventOccurrences` in eventSeries.ts for how this is matched back
 * against the template's generated dates at read time.
 */
export function createSeriesException(
  doc: Y.Doc,
  seriesTemplateId: string,
  occurrenceDate: string,
  overrides: Partial<NewEventInput> = {},
): string {
  const template = getEventOrThrow(doc, seriesTemplateId);
  if (!template.seriesId) throw new Error(`Event is not a series template: ${seriesTemplateId}`);
  // Drop the template's own series fields (and its createdAt — this
  // exception is its own entry, materialized just now, not a continuation
  // of the template's age) explicitly rather than spreading them and
  // overwriting — an explicit `seriesRule: undefined` in the spread source
  // would still leave that key present with an undefined value, which
  // Yjs's Map encoding isn't guaranteed to round-trip cleanly.
  const {
    seriesId: _templateSeriesId,
    seriesRule: _seriesRule,
    occurrenceDate: _templateDate,
    createdAt: _templateCreatedAt,
    ...templateFields
  } = template;

  const id = crypto.randomUUID();
  const event = calendarEventSchema.parse({
    ...templateFields,
    ...overrides,
    seriesId: seriesTemplateId,
    occurrenceDate,
    createdAt: Date.now(),
  });
  doc.getMap('events').set(id, event);
  return id;
}

/** Convenience wrapper over `createSeriesException` for "cancel just this one date" — the series itself, and every other occurrence, is untouched. */
export function cancelOccurrence(doc: Y.Doc, seriesTemplateId: string, occurrenceDate: string): string {
  return createSeriesException(doc, seriesTemplateId, occurrenceDate, { status: 'cancelled' });
}

export function updateEvent(doc: Y.Doc, eventId: string, patch: Partial<CalendarEvent>): void {
  const existing = getEventOrThrow(doc, eventId);
  const updated = calendarEventSchema.parse({ ...existing, ...patch });
  doc.getMap('events').set(eventId, updated);
}

/**
 * Edits whichever occurrence `occurrenceId` refers to — a real entry (a
 * plain event, a series template, or an already-materialized exception) is
 * patched in place via `updateEvent`; a virtual (never-materialized)
 * occurrence has no entry to patch yet, so a fresh exception is created for
 * it instead, carrying `patch` as its overrides. Same "real entry wins,
 * never both" rule `resolveEventOccurrences` already relies on. Editing the
 * series template itself (`occurrenceId === event.seriesId`) is a template
 * edit, affecting every occurrence that doesn't already have its own
 * exception — not a same-occurrence-only edit.
 *
 * Returns the id the edited data now actually lives under — the same
 * `occurrenceId` for a real entry, but a brand-new exception id for a
 * virtual one, since `resolveEventOccurrences` surfaces a materialized
 * exception under its own real id, never the synthetic `templateId@date`
 * one it replaces. A caller still showing a virtual occurrence's own page
 * needs this to navigate to where the data actually ended up — see
 * EventDetail.tsx's own use of it after cancelling one.
 */
export function updateOccurrence(doc: Y.Doc, occurrenceId: string, patch: Partial<NewEventInput>): string {
  if (doc.getMap('events').has(occurrenceId)) {
    updateEvent(doc, occurrenceId, patch);
    return occurrenceId;
  }
  const atIndex = occurrenceId.lastIndexOf('@');
  if (atIndex === -1) throw new Error(`Occurrence not found: ${occurrenceId}`);
  return createSeriesException(doc, occurrenceId.slice(0, atIndex), occurrenceId.slice(atIndex + 1), patch);
}

function deleteAvailabilityForOccurrence(doc: Y.Doc, occurrenceId: string): void {
  const availability = doc.getMap('availability');
  const prefix = `${occurrenceId}:`;
  for (const key of Array.from(availability.keys())) {
    if (key.startsWith(prefix)) availability.delete(key);
  }
}

/** Deletes one event entry (a plain event, or a single series exception) and its own availability answers. To dissolve a whole series, use `deleteEventSeries`. */
export function deleteEvent(doc: Y.Doc, eventId: string): void {
  doc.transact(() => {
    doc.getMap('events').delete(eventId);
    deleteAvailabilityForOccurrence(doc, eventId);
  });
}

/**
 * Dissolves an entire series: the template, every exception entry that
 * references it, and every availability answer for any of those — including
 * the synthetic `${seriesTemplateId}@<date>` keys a virtual (never
 * materialized) occurrence uses, which aren't tied to any real `events`
 * entry to iterate and so are swept by key prefix instead.
 */
export function deleteEventSeries(doc: Y.Doc, seriesTemplateId: string): void {
  const events = doc.getMap('events');
  if (!events.has(seriesTemplateId)) return;

  doc.transact(() => {
    for (const [id, event] of events.entries()) {
      if (id === seriesTemplateId || (event as CalendarEvent).seriesId === seriesTemplateId) {
        events.delete(id);
        deleteAvailabilityForOccurrence(doc, id);
      }
    }

    const availability = doc.getMap('availability');
    const virtualPrefix = `${seriesTemplateId}@`;
    for (const key of Array.from(availability.keys())) {
      if (key.startsWith(virtualPrefix)) availability.delete(key);
    }
  });
}

/**
 * `occurrenceId` is either a real `events` key (a plain event, or a series
 * exception) or a virtual occurrence's synthetic `${templateId}@<date>` id
 * — this function doesn't need to distinguish the two, it just addresses
 * the composite `availability` key. Always the responding user's own
 * `userId`; the server-side hocuspocus guard (docs/adr/0011-calendar-events.md)
 * is what actually stops a client from writing anyone else's.
 */
export function respondAvailability(doc: Y.Doc, occurrenceId: string, userId: string, answer: AvailabilityAnswer): void {
  doc.getMap('availability').set(`${occurrenceId}:${userId}`, answer);
}

export function getAvailability(doc: Y.Doc, occurrenceId: string, userId: string): AvailabilityAnswer | undefined {
  return doc.getMap('availability').get(`${occurrenceId}:${userId}`) as AvailabilityAnswer | undefined;
}

/** Every response for one occurrence, keyed by userId — for an "who hasn't answered yet" view. */
export function listAvailabilityForOccurrence(doc: Y.Doc, occurrenceId: string): Record<string, AvailabilityAnswer> {
  const prefix = `${occurrenceId}:`;
  const result: Record<string, AvailabilityAnswer> = {};
  for (const [key, value] of doc.getMap('availability').entries()) {
    if (key.startsWith(prefix)) result[key.slice(prefix.length)] = value as AvailabilityAnswer;
  }
  return result;
}
