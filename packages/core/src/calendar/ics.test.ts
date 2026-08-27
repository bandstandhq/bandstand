// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { buildIcsFeed, type IcsFeedEntry } from './ics';

function baseEntry(overrides: Partial<IcsFeedEntry> = {}): IcsFeedEntry {
  return {
    uid: 'band-1:event-1',
    bandName: 'The Demo Band',
    title: 'Weekly practice',
    startsAt: Date.parse('2026-09-10T18:00:00.000Z'),
    allDay: false,
    status: 'confirmed',
    ...overrides,
  };
}

describe('buildIcsFeed', () => {
  it('wraps events in a valid VCALENDAR with the required VEVENT fields', () => {
    const ics = buildIcsFeed([baseEntry()], Date.parse('2026-09-01T00:00:00.000Z'));
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:band-1:event-1');
    expect(ics).toContain('DTSTAMP:20260901T000000Z');
    expect(ics).toContain('DTSTART:20260910T180000Z');
    expect(ics).toContain('SUMMARY:The Demo Band: Weekly practice');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics.endsWith('\r\n')).toBe(true);
  });

  it('uses VALUE=DATE for an all-day event, not a timestamp', () => {
    const ics = buildIcsFeed([baseEntry({ allDay: true, endsAt: Date.parse('2026-09-11T00:00:00.000Z') })]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260910');
    expect(ics).toContain('DTEND;VALUE=DATE:20260911');
  });

  it('includes DTEND only when endsAt is given', () => {
    const withEnd = buildIcsFeed([baseEntry({ endsAt: Date.parse('2026-09-10T20:00:00.000Z') })]);
    expect(withEnd).toContain('DTEND:20260910T200000Z');

    const withoutEnd = buildIcsFeed([baseEntry()]);
    expect(withoutEnd).not.toContain('DTEND');
  });

  it('emits STATUS:CANCELLED for a cancelled event rather than omitting it', () => {
    const ics = buildIcsFeed([baseEntry({ status: 'cancelled' })]);
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('STATUS:CANCELLED');
  });

  it('escapes commas, semicolons, backslashes, and newlines in text fields', () => {
    const ics = buildIcsFeed([baseEntry({ title: 'Gig; drinks, snacks\nand a raffle', location: undefined })]);
    expect(ics).toContain('SUMMARY:The Demo Band: Gig\\; drinks\\, snacks\\nand a raffle');
  });

  it('includes LOCATION only when given', () => {
    const withLocation = buildIcsFeed([baseEntry({ location: 'The Venue' })]);
    expect(withLocation).toContain('LOCATION:The Venue');

    const withoutLocation = buildIcsFeed([baseEntry()]);
    expect(withoutLocation).not.toContain('LOCATION');
  });

  it('emits one VEVENT per entry, in the given order', () => {
    const ics = buildIcsFeed([baseEntry({ uid: 'a' }), baseEntry({ uid: 'b' })]);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.indexOf('UID:a')).toBeLessThan(ics.indexOf('UID:b'));
  });

  it('produces a valid (empty) calendar for no entries', () => {
    const ics = buildIcsFeed([]);
    expect(ics).not.toContain('VEVENT');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
  });
});
