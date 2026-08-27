// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { calendarEventSchema, locationGeoSchema, seriesRuleSchema } from './event';

function baseEvent() {
  return {
    type: 'rehearsal' as const,
    title: 'Weekly practice',
    startsAt: 1_700_000_000_000,
    allDay: false,
    status: 'confirmed' as const,
  };
}

describe('calendarEventSchema', () => {
  it('accepts a minimal, non-recurring event', () => {
    expect(() => calendarEventSchema.parse(baseEvent())).not.toThrow();
  });

  it('accepts a full event with location, geo, notes, and a linked setlist', () => {
    expect(() =>
      calendarEventSchema.parse({
        ...baseEvent(),
        type: 'gig',
        endsAt: 1_700_010_000_000,
        location: '123 Main St',
        locationGeo: { lat: 52.5, lng: 13.4 },
        notes: 'Load in at 6pm',
        setlistId: 'setlist-1',
        status: 'tentative',
      }),
    ).not.toThrow();
  });

  it('accepts a series template with a seriesRule', () => {
    expect(() =>
      calendarEventSchema.parse({
        ...baseEvent(),
        seriesId: 'series-1',
        seriesRule: { freq: 'weekly', until: '2026-12-31' },
      }),
    ).not.toThrow();
  });

  it('accepts an exception entry with an occurrenceDate but no seriesRule', () => {
    expect(() =>
      calendarEventSchema.parse({
        ...baseEvent(),
        seriesId: 'series-1',
        occurrenceDate: '2026-09-14',
        status: 'cancelled',
      }),
    ).not.toThrow();
  });

  it('rejects an empty title', () => {
    expect(() => calendarEventSchema.parse({ ...baseEvent(), title: '' })).toThrow();
  });

  it('rejects an invalid status/type', () => {
    expect(() => calendarEventSchema.parse({ ...baseEvent(), status: 'maybe' })).toThrow();
    expect(() => calendarEventSchema.parse({ ...baseEvent(), type: 'party' })).toThrow();
  });
});

describe('seriesRuleSchema', () => {
  it('accepts a rule with no until (open-ended)', () => {
    expect(() => seriesRuleSchema.parse({ freq: 'monthly' })).not.toThrow();
  });

  it('rejects an unknown frequency', () => {
    expect(() => seriesRuleSchema.parse({ freq: 'daily' })).toThrow();
  });
});

describe('locationGeoSchema', () => {
  it('accepts valid coordinates', () => {
    expect(() => locationGeoSchema.parse({ lat: -33.8, lng: 151.2 })).not.toThrow();
  });

  it('rejects out-of-range latitude/longitude', () => {
    expect(() => locationGeoSchema.parse({ lat: 200, lng: 0 })).toThrow();
    expect(() => locationGeoSchema.parse({ lat: 0, lng: -200 })).toThrow();
  });
});
