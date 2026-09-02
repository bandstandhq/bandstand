// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { resolveEventOccurrences } from './eventSeries';
import {
  cancelOccurrence,
  changeSeriesRecurrence,
  createEvent,
  createRecurringEvent,
  createSeriesException,
  deleteEvent,
  deleteEventSeries,
  getAvailability,
  listAvailabilityForOccurrence,
  listEvents,
  respondAvailability,
  updateEvent,
  updateOccurrence,
} from './events';

function baseInput() {
  return {
    type: 'rehearsal' as const,
    title: 'Weekly practice',
    startsAt: 1_700_000_000_000,
    allDay: false,
    status: 'confirmed' as const,
  };
}

describe('createEvent / updateEvent', () => {
  it('creates a plain, non-recurring event', () => {
    const doc = new Y.Doc();
    const id = createEvent(doc, baseInput());

    const events = listEvents(doc);
    expect(events[id]).toMatchObject({ title: 'Weekly practice' });
    expect(events[id]?.seriesId).toBeUndefined();
  });

  it('updates fields via a patch, validating the merged result', () => {
    const doc = new Y.Doc();
    const id = createEvent(doc, baseInput());

    updateEvent(doc, id, { status: 'cancelled', notes: 'Rescheduling' });

    const events = listEvents(doc);
    expect(events[id]).toMatchObject({ status: 'cancelled', notes: 'Rescheduling', title: 'Weekly practice' });
  });

  it('throws updating a nonexistent event', () => {
    const doc = new Y.Doc();
    expect(() => updateEvent(doc, 'missing', { status: 'cancelled' })).toThrow('Event not found');
  });

  it('sets createdAt on creation and never changes it on a later edit', () => {
    const doc = new Y.Doc();
    const before = Date.now();
    const id = createEvent(doc, baseInput());
    const createdAt = listEvents(doc)[id]?.createdAt;
    expect(createdAt).toBeGreaterThanOrEqual(before);
    expect(createdAt).toBeLessThanOrEqual(Date.now());

    updateEvent(doc, id, { title: 'Renamed' });

    expect(listEvents(doc)[id]?.createdAt).toBe(createdAt);
  });
});

describe('createRecurringEvent', () => {
  it('sets seriesId to its own generated id', () => {
    const doc = new Y.Doc();
    const id = createRecurringEvent(doc, baseInput(), { freq: 'weekly' });

    const events = listEvents(doc);
    expect(events[id]?.seriesId).toBe(id);
    expect(events[id]?.seriesRule).toEqual({ freq: 'weekly' });
  });
});

describe('createSeriesException / cancelOccurrence', () => {
  it('creates a separate entry referencing the template, without mutating it', () => {
    const doc = new Y.Doc();
    const templateId = createRecurringEvent(doc, baseInput(), { freq: 'weekly' });

    const exceptionId = createSeriesException(doc, templateId, '2026-09-14', { title: 'Extra long practice' });

    const events = listEvents(doc);
    expect(exceptionId).not.toBe(templateId);
    expect(events[exceptionId]).toMatchObject({
      seriesId: templateId,
      occurrenceDate: '2026-09-14',
      title: 'Extra long practice',
    });
    expect(events[exceptionId]?.seriesRule).toBeUndefined();
    // The template itself is untouched.
    expect(events[templateId]).toMatchObject({ title: 'Weekly practice' });
  });

  it('cancelOccurrence creates a cancelled exception without touching the series', () => {
    const doc = new Y.Doc();
    const templateId = createRecurringEvent(doc, baseInput(), { freq: 'weekly' });

    const exceptionId = cancelOccurrence(doc, templateId, '2026-09-14');

    const events = listEvents(doc);
    expect(events[exceptionId]).toMatchObject({ seriesId: templateId, occurrenceDate: '2026-09-14', status: 'cancelled' });
    expect(events[templateId]?.status).toBe('confirmed');
  });

  it('throws creating an exception against a non-series event', () => {
    const doc = new Y.Doc();
    const id = createEvent(doc, baseInput());
    expect(() => createSeriesException(doc, id, '2026-09-14')).toThrow('not a series template');
  });

  it('gives the exception its own fresh createdAt, not the template\'s', async () => {
    const doc = new Y.Doc();
    const templateId = createRecurringEvent(doc, baseInput(), { freq: 'weekly' });
    const templateCreatedAt = listEvents(doc)[templateId]!.createdAt!;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const exceptionId = createSeriesException(doc, templateId, '2026-09-14');

    expect(listEvents(doc)[exceptionId]?.createdAt).toBeGreaterThan(templateCreatedAt);
  });
});

describe('updateOccurrence', () => {
  it('patches a plain event in place, same as updateEvent, returning the same id', () => {
    const doc = new Y.Doc();
    const id = createEvent(doc, baseInput());

    const result = updateOccurrence(doc, id, { title: 'Renamed practice' });

    expect(result).toBe(id);
    expect(listEvents(doc)[id]).toMatchObject({ title: 'Renamed practice' });
  });

  it('patches the series template when the occurrence id is the template itself, returning the same id', () => {
    const doc = new Y.Doc();
    const templateId = createRecurringEvent(doc, baseInput(), { freq: 'weekly' });

    const result = updateOccurrence(doc, templateId, { location: 'New venue' });

    expect(result).toBe(templateId);
    expect(listEvents(doc)[templateId]).toMatchObject({ location: 'New venue', seriesId: templateId });
  });

  it('patches an already-materialized exception in place, not the template, returning the same id', () => {
    const doc = new Y.Doc();
    const templateId = createRecurringEvent(doc, baseInput(), { freq: 'weekly' });
    const exceptionId = createSeriesException(doc, templateId, '2026-09-14', { title: 'Extra long practice' });

    const result = updateOccurrence(doc, exceptionId, { location: 'Different room' });

    expect(result).toBe(exceptionId);
    expect(listEvents(doc)[exceptionId]).toMatchObject({ title: 'Extra long practice', location: 'Different room' });
    expect(listEvents(doc)[templateId]).not.toHaveProperty('location');
  });

  it('materializes a fresh exception for a virtual (never-created) occurrence, returning its new real id', () => {
    const doc = new Y.Doc();
    const templateId = createRecurringEvent(doc, baseInput(), { freq: 'weekly' });
    const virtualOccurrenceId = `${templateId}@2026-09-14`;
    expect(listEvents(doc)[virtualOccurrenceId]).toBeUndefined();

    const result = updateOccurrence(doc, virtualOccurrenceId, { title: 'Extra long practice' });

    // Never the synthetic id passed in — a caller still showing that page
    // needs the real id to navigate to, since the synthetic one now
    // resolves to nothing (see EventDetail.tsx's own use of this).
    expect(result).not.toBe(virtualOccurrenceId);
    const events = listEvents(doc);
    expect(events[result]).toMatchObject({ occurrenceDate: '2026-09-14', title: 'Extra long practice', seriesId: templateId });
    expect(events[templateId]).toMatchObject({ title: 'Weekly practice' });
  });

  it('throws for an occurrence id that matches neither a real entry nor a virtual one', () => {
    const doc = new Y.Doc();
    expect(() => updateOccurrence(doc, 'not-an-occurrence-id', { title: 'x' })).toThrow('Occurrence not found');
  });
});

describe('changeSeriesRecurrence', () => {
  // Weekly from 2023-11-14 (Tue): ...-11-21, -11-28, -12-05, -12-12 (split
  // point below, n=4), -12-19, -12-26 (n=6), ...
  const SPLIT_DATE = '2023-12-12';

  it('caps the old template at the day before the split, and starts a new template with the new rule from the split date', () => {
    const doc = new Y.Doc();
    const oldTemplateId = createRecurringEvent(doc, baseInput(), { freq: 'weekly' });

    const newTemplateId = changeSeriesRecurrence(doc, oldTemplateId, SPLIT_DATE, { freq: 'biweekly' });

    const events = listEvents(doc);
    expect(events[oldTemplateId]?.seriesRule).toEqual({ freq: 'weekly', until: '2023-12-11' });
    expect(newTemplateId).not.toBe(oldTemplateId);
    expect(events[newTemplateId]).toMatchObject({
      seriesId: newTemplateId,
      seriesRule: { freq: 'biweekly' },
      title: 'Weekly practice',
    });
    expect(new Date(events[newTemplateId]!.startsAt).toISOString().slice(0, 10)).toBe(SPLIT_DATE);
    // Same time-of-day as the old template's own occurrences, not midnight.
    expect(new Date(events[newTemplateId]!.startsAt).getUTCHours()).toBe(new Date(baseInput().startsAt).getUTCHours());
  });

  it('carries the old template\'s other fields over to the new one', () => {
    const doc = new Y.Doc();
    const oldTemplateId = createRecurringEvent(doc, { ...baseInput(), location: 'Rehearsal room', notes: 'Bring amps' }, {
      freq: 'weekly',
    });

    const newTemplateId = changeSeriesRecurrence(doc, oldTemplateId, SPLIT_DATE, { freq: 'monthlyByWeekday' });

    expect(listEvents(doc)[newTemplateId]).toMatchObject({ location: 'Rehearsal room', notes: 'Bring amps' });
  });

  it('leaves an exception dated before the split date attached to, and still resolved via, the old template', () => {
    const doc = new Y.Doc();
    const oldTemplateId = createRecurringEvent(doc, baseInput(), { freq: 'weekly' });
    const exceptionId = createSeriesException(doc, oldTemplateId, '2023-11-28', { title: 'Extra long practice' });

    changeSeriesRecurrence(doc, oldTemplateId, SPLIT_DATE, { freq: 'biweekly' });

    const resolved = resolveEventOccurrences(listEvents(doc), Date.parse('2023-11-01'), Date.parse('2023-12-01'));
    expect(resolved.find((o) => o.occurrenceId === exceptionId)?.event.title).toBe('Extra long practice');
  });

  it('stops surfacing an existing exception dated on or after the split date — it stays in the doc, but neither template reaches it anymore', () => {
    const doc = new Y.Doc();
    const oldTemplateId = createRecurringEvent(doc, baseInput(), { freq: 'weekly' });
    const exceptionId = cancelOccurrence(doc, oldTemplateId, '2023-12-26');

    changeSeriesRecurrence(doc, oldTemplateId, SPLIT_DATE, { freq: 'biweekly' });

    // Still there — not deleted...
    expect(listEvents(doc)[exceptionId]).toBeDefined();
    // ...but resolveEventOccurrences never walks far enough into the
    // (now-capped) old template to reach it, and the new template's own
    // biweekly cadence from 2023-12-12 never lands on 2023-12-26 either.
    const resolved = resolveEventOccurrences(listEvents(doc), Date.parse('2023-12-01'), Date.parse('2024-01-01'));
    expect(resolved.find((o) => o.occurrenceId === exceptionId)).toBeUndefined();
  });

  it('returns the new template\'s id, distinct from the old one', () => {
    const doc = new Y.Doc();
    const oldTemplateId = createRecurringEvent(doc, baseInput(), { freq: 'weekly' });

    const newTemplateId = changeSeriesRecurrence(doc, oldTemplateId, SPLIT_DATE, { freq: 'biweekly' });

    expect(newTemplateId).not.toBe(oldTemplateId);
    expect(listEvents(doc)[newTemplateId]?.seriesId).toBe(newTemplateId);
  });

  it('throws for an event that is not a series template', () => {
    const doc = new Y.Doc();
    const plainId = createEvent(doc, baseInput());
    expect(() => changeSeriesRecurrence(doc, plainId, SPLIT_DATE, { freq: 'weekly' })).toThrow('not a series template');
  });

  it('throws for a date the old series never generates', () => {
    const doc = new Y.Doc();
    const oldTemplateId = createRecurringEvent(doc, baseInput(), { freq: 'weekly' });
    // A Wednesday — the series only ever lands on Tuesdays.
    expect(() => changeSeriesRecurrence(doc, oldTemplateId, '2023-12-13', { freq: 'weekly' })).toThrow('not a date this series generates');
  });
});

describe('deleteEvent', () => {
  it('removes the event and its own availability answers', () => {
    const doc = new Y.Doc();
    const id = createEvent(doc, baseInput());
    respondAvailability(doc, id, 'u1', 'yes');
    respondAvailability(doc, id, 'u2', 'no');

    deleteEvent(doc, id);

    expect(listEvents(doc)[id]).toBeUndefined();
    expect(listAvailabilityForOccurrence(doc, id)).toEqual({});
  });
});

describe('deleteEventSeries', () => {
  it('removes the template, every exception, and every real + synthetic availability answer', () => {
    const doc = new Y.Doc();
    const templateId = createRecurringEvent(doc, baseInput(), { freq: 'weekly' });
    const exceptionId = createSeriesException(doc, templateId, '2026-09-14', { title: 'Extra long' });
    const otherId = createEvent(doc, { ...baseInput(), title: 'Unrelated event' });

    respondAvailability(doc, templateId, 'u1', 'yes'); // never realistic (template's own id isn't used as an occurrence key), but must still be swept
    respondAvailability(doc, exceptionId, 'u1', 'maybe');
    respondAvailability(doc, `${templateId}@2026-09-07`, 'u2', 'no'); // a virtual occurrence's synthetic key
    respondAvailability(doc, otherId, 'u1', 'yes');

    deleteEventSeries(doc, templateId);

    const events = listEvents(doc);
    expect(events[templateId]).toBeUndefined();
    expect(events[exceptionId]).toBeUndefined();
    expect(events[otherId]).toMatchObject({ title: 'Unrelated event' });
    expect(listAvailabilityForOccurrence(doc, templateId)).toEqual({});
    expect(listAvailabilityForOccurrence(doc, exceptionId)).toEqual({});
    expect(listAvailabilityForOccurrence(doc, `${templateId}@2026-09-07`)).toEqual({});
    expect(listAvailabilityForOccurrence(doc, otherId)).toEqual({ u1: 'yes' });
  });

  it('is a no-op for a nonexistent template', () => {
    const doc = new Y.Doc();
    expect(() => deleteEventSeries(doc, 'missing')).not.toThrow();
  });
});

describe('respondAvailability / getAvailability / listAvailabilityForOccurrence', () => {
  it('round-trips a response and lists every response for an occurrence', () => {
    const doc = new Y.Doc();
    const id = createEvent(doc, baseInput());

    respondAvailability(doc, id, 'u1', 'yes');
    respondAvailability(doc, id, 'u2', 'maybe');

    expect(getAvailability(doc, id, 'u1')).toBe('yes');
    expect(getAvailability(doc, id, 'u3')).toBeUndefined();
    expect(listAvailabilityForOccurrence(doc, id)).toEqual({ u1: 'yes', u2: 'maybe' });
  });

  it('overwrites a user\'s own prior response rather than duplicating it', () => {
    const doc = new Y.Doc();
    const id = createEvent(doc, baseInput());

    respondAvailability(doc, id, 'u1', 'yes');
    respondAvailability(doc, id, 'u1', 'no');

    expect(listAvailabilityForOccurrence(doc, id)).toEqual({ u1: 'no' });
  });

  it('works identically for a virtual occurrence\'s synthetic id', () => {
    const doc = new Y.Doc();
    const occurrenceId = 'template-1@2026-09-14';

    respondAvailability(doc, occurrenceId, 'u1', 'yes');

    expect(getAvailability(doc, occurrenceId, 'u1')).toBe('yes');
  });
});
