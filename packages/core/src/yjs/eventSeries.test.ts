// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../schemas/event';
import { findOccurrenceEvent, resolveEventOccurrences, resolveTemplateGeneratedStartsAt } from './eventSeries';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function template(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    type: 'rehearsal',
    title: 'Weekly practice',
    startsAt: Date.parse('2026-01-05T18:00:00.000Z'), // a Monday
    endsAt: Date.parse('2026-01-05T20:00:00.000Z'),
    allDay: false,
    status: 'confirmed',
    seriesId: 'series-1',
    seriesRule: { freq: 'weekly' },
    ...overrides,
  };
}

describe('resolveEventOccurrences', () => {
  it('includes a plain, non-recurring event only when its startsAt falls in range', () => {
    const plain: CalendarEvent = {
      type: 'gig',
      title: 'One-off show',
      startsAt: Date.parse('2026-02-01T20:00:00.000Z'),
      allDay: false,
      status: 'confirmed',
    };
    const events = { e1: plain };

    expect(resolveEventOccurrences(events, Date.parse('2026-01-01'), Date.parse('2026-03-01'))).toHaveLength(1);
    expect(resolveEventOccurrences(events, Date.parse('2026-03-01'), Date.parse('2026-04-01'))).toHaveLength(0);
  });

  it('walks a weekly series forward, one occurrence per week, with synthetic occurrence ids', () => {
    const events = { 'series-1': template() };
    const rangeStart = Date.parse('2026-01-01T00:00:00.000Z');
    const rangeEnd = Date.parse('2026-01-31T23:59:59.000Z');

    const occurrences = resolveEventOccurrences(events, rangeStart, rangeEnd);

    expect(occurrences.map((o) => o.date)).toEqual(['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']);
    expect(occurrences.every((o) => o.occurrenceId === `series-1@${o.date}`)).toBe(true);
    // The template's own data is never mutated — each synthesized
    // occurrence just carries a shifted startsAt/endsAt.
    expect(occurrences[1]?.event.startsAt).toBe(template().startsAt + WEEK_MS);
    expect(occurrences[1]?.event.endsAt).toBe(template().endsAt! + WEEK_MS);
    expect(occurrences[1]?.event.title).toBe('Weekly practice');
  });

  it('an exception overrides the generated occurrence on its date with its own real id and data', () => {
    const events = {
      'series-1': template(),
      'exc-1': template({
        title: 'Extra long practice',
        seriesRule: undefined,
        occurrenceDate: '2026-01-12',
        startsAt: Date.parse('2026-01-12T17:00:00.000Z'),
      }),
    };

    const occurrences = resolveEventOccurrences(events, Date.parse('2026-01-01'), Date.parse('2026-01-31'));
    const overridden = occurrences.find((o) => o.date === '2026-01-12');

    expect(overridden?.occurrenceId).toBe('exc-1');
    expect(overridden?.event.title).toBe('Extra long practice');
  });

  it('a cancelled exception suppresses that date entirely, without affecting other occurrences', () => {
    const events = {
      'series-1': template(),
      'exc-1': template({
        seriesRule: undefined,
        occurrenceDate: '2026-01-12',
        status: 'cancelled',
      }),
    };

    const occurrences = resolveEventOccurrences(events, Date.parse('2026-01-01'), Date.parse('2026-01-31'));

    expect(occurrences.map((o) => o.date)).toEqual(['2026-01-05', '2026-01-19', '2026-01-26']);
  });

  it('an exception entry is never itself surfaced as a standalone event', () => {
    const events = {
      'series-1': template(),
      'exc-1': template({ seriesRule: undefined, occurrenceDate: '2026-01-12' }),
    };

    // Before the series even starts (Jan 5) — the template generates
    // nothing here, so the only way this could return a result is if the
    // exception entry were (incorrectly) iterated as its own standalone
    // event using its inherited (unmodified) startsAt.
    const occurrences = resolveEventOccurrences(events, Date.parse('2025-12-01'), Date.parse('2025-12-31'));
    expect(occurrences).toHaveLength(0);
  });

  it('an orphaned exception (its template no longer exists) is simply omitted', () => {
    const events = {
      'exc-1': template({ seriesRule: undefined, seriesId: 'missing-template', occurrenceDate: '2026-01-12' }),
    };

    expect(resolveEventOccurrences(events, Date.parse('2026-01-01'), Date.parse('2026-01-31'))).toHaveLength(0);
  });

  it('respects a range that starts long after the series began, without scanning every prior week', () => {
    const events = { 'series-1': template({ startsAt: Date.parse('2020-01-06T18:00:00.000Z') }) };

    const occurrences = resolveEventOccurrences(events, Date.parse('2026-01-01'), Date.parse('2026-01-31'));

    expect(occurrences.map((o) => o.date)).toEqual(['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']);
  });

  it('respects an explicit `until`', () => {
    const events = { 'series-1': template({ seriesRule: { freq: 'weekly', until: '2026-01-12' } }) };

    const occurrences = resolveEventOccurrences(events, Date.parse('2026-01-01'), Date.parse('2026-03-01'));

    expect(occurrences.map((o) => o.date)).toEqual(['2026-01-05', '2026-01-12']);
  });

  it('caps an until-less series at 200 occurrences / two years past the range, even over a 50-year range', () => {
    const events = { 'series-1': template() };
    const rangeStart = template().startsAt;
    const rangeEnd = rangeStart + 50 * 365 * DAY_MS;

    const occurrences = resolveEventOccurrences(events, rangeStart, rangeEnd);

    expect(occurrences.length).toBeGreaterThan(0);
    expect(occurrences.length).toBeLessThanOrEqual(200);
    const lastDate = Date.parse(occurrences.at(-1)!.date);
    expect(lastDate).toBeLessThanOrEqual(rangeStart + 2 * 365 * DAY_MS + DAY_MS);
  });

  it('walks a monthly series forward, one occurrence per calendar month', () => {
    const events = { 'series-1': template({ startsAt: Date.parse('2026-01-15T18:00:00.000Z'), seriesRule: { freq: 'monthly' } }) };

    const occurrences = resolveEventOccurrences(events, Date.parse('2026-01-01'), Date.parse('2026-04-01'));

    expect(occurrences.map((o) => o.date)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
  });

  it('a monthly series starting on the 31st clamps to the shorter month\'s last day, instead of rolling into the month after', () => {
    const events = { 'series-1': template({ startsAt: Date.parse('2026-01-31T18:00:00.000Z'), seriesRule: { freq: 'monthly' } }) };

    const occurrences = resolveEventOccurrences(events, Date.parse('2026-01-01'), Date.parse('2026-04-01'));

    // Naive `setUTCMonth` arithmetic on a day-31 date lands Feb's occurrence
    // on Mar 3 (Feb only has 28 days in 2026) — every occurrence here must
    // stay within the calendar month it was meant for.
    expect(occurrences.map((o) => o.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('sorts the combined result by effective start time', () => {
    const events = {
      'series-1': template(),
      'plain-1': {
        type: 'gig' as const,
        title: 'Mid-series one-off',
        startsAt: Date.parse('2026-01-08T12:00:00.000Z'),
        allDay: false,
        status: 'confirmed' as const,
      },
    };

    const occurrences = resolveEventOccurrences(events, Date.parse('2026-01-01'), Date.parse('2026-01-15'));

    expect(occurrences.map((o) => o.occurrenceId)).toEqual(['series-1@2026-01-05', 'plain-1', 'series-1@2026-01-12']);
  });
});

describe('findOccurrenceEvent', () => {
  it('looks up a plain event directly', () => {
    const plain: CalendarEvent = {
      type: 'gig',
      title: 'One-off show',
      startsAt: Date.parse('2026-02-01T20:00:00.000Z'),
      allDay: false,
      status: 'confirmed',
    };
    expect(findOccurrenceEvent({ e1: plain }, 'e1')).toBe(plain);
  });

  it('looks up an exception directly, by its own real id', () => {
    const exception = template({ seriesRule: undefined, occurrenceDate: '2026-01-12', title: 'Extra long' });
    expect(findOccurrenceEvent({ 'series-1': template(), 'exc-1': exception }, 'exc-1')).toBe(exception);
  });

  it('resolves a virtual occurrence\'s synthetic id via the series walk', () => {
    const events = { 'series-1': template() };
    const found = findOccurrenceEvent(events, 'series-1@2026-01-12');
    expect(found?.startsAt).toBe(Date.parse('2026-01-12T18:00:00.000Z'));
    expect(found?.title).toBe('Weekly practice');
  });

  it('returns undefined for an unknown id', () => {
    expect(findOccurrenceEvent({}, 'missing')).toBeUndefined();
    expect(findOccurrenceEvent({}, 'missing@2026-01-12')).toBeUndefined();
  });
});

function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00.000Z`).getUTCDay();
}

describe('recurrence lands on the same weekday every time (point 7: verify weekly/biweekly, extend to every4weeks/monthlyByWeekday)', () => {
  it('weekly never drifts off its start weekday, month after month', () => {
    const events = { 'series-1': template({ startsAt: Date.parse('2026-01-05T18:00:00.000Z') }) }; // a Monday
    const dates = resolveEventOccurrences(events, Date.parse('2026-01-01'), Date.parse('2026-06-01')).map((o) => o.date);
    expect(dates.length).toBeGreaterThan(10);
    expect(dates.every((d) => weekdayOf(d) === 1)).toBe(true); // Monday every time
  });

  it('biweekly never drifts off its start weekday either', () => {
    const events = { 'series-1': template({ startsAt: Date.parse('2026-01-06T18:00:00.000Z'), seriesRule: { freq: 'biweekly' } }) }; // a Tuesday
    const dates = resolveEventOccurrences(events, Date.parse('2026-01-01'), Date.parse('2026-06-01')).map((o) => o.date);
    expect(dates.length).toBeGreaterThan(5);
    expect(dates.every((d) => weekdayOf(d) === 2)).toBe(true); // Tuesday every time
  });

  it('every4weeks lands on the same weekday every time, unlike legacy monthly', () => {
    const events = {
      'series-1': template({ startsAt: Date.parse('2026-01-07T18:00:00.000Z'), seriesRule: { freq: 'every4weeks' } }), // a Wednesday
    };
    const dates = resolveEventOccurrences(events, Date.parse('2026-01-01'), Date.parse('2026-12-01')).map((o) => o.date);
    expect(dates.length).toBeGreaterThan(8);
    expect(dates.every((d) => weekdayOf(d) === 3)).toBe(true); // Wednesday every time
    expect(dates).toEqual(['2026-01-07', '2026-02-04', '2026-03-04', '2026-04-01', '2026-04-29', '2026-05-27', '2026-06-24', '2026-07-22', '2026-08-19', '2026-09-16', '2026-10-14', '2026-11-11']);
  });

  it('monthlyByWeekday re-derives "the Nth weekday" from the template\'s own start date and lands on it every month', () => {
    // 2026-01-05 is the first Monday of January.
    const events = {
      'series-1': template({ startsAt: Date.parse('2026-01-05T18:00:00.000Z'), seriesRule: { freq: 'monthlyByWeekday' } }),
    };
    const dates = resolveEventOccurrences(events, Date.parse('2026-01-01'), Date.parse('2026-07-01')).map((o) => o.date);
    // The first Monday of each month, Jan through Jun 2026.
    expect(dates).toEqual(['2026-01-05', '2026-02-02', '2026-03-02', '2026-04-06', '2026-05-04', '2026-06-01']);
    expect(dates.every((d) => weekdayOf(d) === 1)).toBe(true);
  });

  it('monthlyByWeekday also works for a later ordinal, matching "jeden zweiten Dienstag"', () => {
    // 2026-01-13 is the second Tuesday of January.
    const events = {
      'series-1': template({ startsAt: Date.parse('2026-01-13T18:00:00.000Z'), seriesRule: { freq: 'monthlyByWeekday' } }),
    };
    const dates = resolveEventOccurrences(events, Date.parse('2026-01-01'), Date.parse('2026-05-01')).map((o) => o.date);
    expect(dates).toEqual(['2026-01-13', '2026-02-10', '2026-03-10', '2026-04-14']);
    expect(dates.every((d) => weekdayOf(d) === 2)).toBe(true);
  });

  it('monthlyByWeekday falls back to the last occurrence in a month too short for a rare 5th one', () => {
    // 2026-01-30 is the fifth Friday of January 2026 — most months only have four Fridays.
    const events = {
      'series-1': template({ startsAt: Date.parse('2026-01-30T18:00:00.000Z'), seriesRule: { freq: 'monthlyByWeekday' } }),
    };
    const dates = resolveEventOccurrences(events, Date.parse('2026-01-01'), Date.parse('2026-04-01')).map((o) => o.date);
    // February 2026 has only four Fridays — lands on the last one, not a skip or an overflow into March.
    expect(dates).toEqual(['2026-01-30', '2026-02-27', '2026-03-27']);
    expect(dates.every((d) => weekdayOf(d) === 5)).toBe(true);
  });
});

describe('resolveTemplateGeneratedStartsAt', () => {
  it('returns the unmodified generated time for a date the template actually lands on', () => {
    const t = template({ startsAt: Date.parse('2026-01-05T18:00:00.000Z') }); // weekly, Mondays
    expect(resolveTemplateGeneratedStartsAt(t, '2026-01-19')).toBe(Date.parse('2026-01-19T18:00:00.000Z'));
  });

  it('is unaffected by an exception\'s own, different time — it always describes the original slot', () => {
    // Simulates the caller passing the template itself, never the exception —
    // this only proves the function ignores any exception, since it never
    // receives one.
    const t = template({ startsAt: Date.parse('2026-01-05T18:00:00.000Z') });
    expect(resolveTemplateGeneratedStartsAt(t, '2026-01-12')).toBe(Date.parse('2026-01-12T18:00:00.000Z'));
  });

  it('returns undefined for a date the template never actually generates', () => {
    const t = template({ startsAt: Date.parse('2026-01-05T18:00:00.000Z') }); // weekly, Mondays
    expect(resolveTemplateGeneratedStartsAt(t, '2026-01-06')).toBeUndefined(); // a Tuesday, never generated
  });

  it('returns undefined for a non-series event', () => {
    const plain: CalendarEvent = { type: 'gig', title: 'One-off', startsAt: 1, allDay: false, status: 'confirmed' };
    expect(resolveTemplateGeneratedStartsAt(plain, '2026-01-06')).toBeUndefined();
  });
});
