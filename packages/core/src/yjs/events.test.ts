// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  cancelOccurrence,
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
