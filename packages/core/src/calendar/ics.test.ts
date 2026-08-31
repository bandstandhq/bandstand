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

  it('escapes a bare carriage return so it cannot terminate the property line', () => {
    // A raw \r (not part of a \r\n pair) is treated as a line terminator by
    // many real ICS parsers — left unescaped, it would let a crafted title
    // inject arbitrary following lines into the feed. The injected text
    // itself contains the literal string "BEGIN:VEVENT", so the assertion
    // below checks for a real control line (preceded by an actual \r\n),
    // not just the substring's presence anywhere in the output.
    const ics = buildIcsFeed([baseEntry({ title: 'Line one\rEND:VEVENT\rBEGIN:VEVENT', location: undefined })]);
    expect(ics).toContain('SUMMARY:The Demo Band: Line one\\nEND:VEVENT\\nBEGIN:VEVENT');
    expect(ics.match(/\r\nBEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics.match(/\r\nEND:VEVENT/g)).toHaveLength(1);
  });

  it('escapes a Windows-style \\r\\n pair as a single newline marker, not two', () => {
    const ics = buildIcsFeed([baseEntry({ title: 'Line one\r\nLine two', location: undefined })]);
    expect(ics).toContain('SUMMARY:The Demo Band: Line one\\nLine two');
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

  describe('recurring series (point 7: RRULE, not one VEVENT per generated occurrence)', () => {
    it('emits a single VEVENT with an RRULE for a weekly series, not one per date', () => {
      const ics = buildIcsFeed([baseEntry({ recurrence: { freq: 'weekly' } })]);
      expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
      expect(ics).toContain('RRULE:FREQ=WEEKLY');
    });

    it('maps biweekly and every4weeks onto FREQ=WEEKLY with the matching INTERVAL', () => {
      expect(buildIcsFeed([baseEntry({ recurrence: { freq: 'biweekly' } })])).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2');
      expect(buildIcsFeed([baseEntry({ recurrence: { freq: 'every4weeks' } })])).toContain('RRULE:FREQ=WEEKLY;INTERVAL=4');
    });

    it('maps monthlyByWeekday onto FREQ=MONTHLY;BYDAY=<ordinal><weekday>, derived from DTSTART', () => {
      // 2026-09-10 is a Thursday, the second one of September 2026.
      const ics = buildIcsFeed([baseEntry({ startsAt: Date.parse('2026-09-10T18:00:00.000Z'), recurrence: { freq: 'monthlyByWeekday' } })]);
      expect(ics).toContain('RRULE:FREQ=MONTHLY;BYDAY=2TH');
    });

    it('maps legacy monthly onto plain FREQ=MONTHLY', () => {
      const ics = buildIcsFeed([baseEntry({ recurrence: { freq: 'monthly' } })]);
      expect(ics).toContain('RRULE:FREQ=MONTHLY');
      expect(ics).not.toContain('BYDAY');
    });

    it('appends UNTIL, as a plain date for an all-day series and end-of-day UTC otherwise', () => {
      const timed = buildIcsFeed([baseEntry({ recurrence: { freq: 'weekly', until: '2026-12-31' } })]);
      expect(timed).toContain('RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z');

      const allDay = buildIcsFeed([baseEntry({ allDay: true, recurrence: { freq: 'weekly', until: '2026-12-31' } })]);
      expect(allDay).toContain('RRULE:FREQ=WEEKLY;UNTIL=20261231');
    });

    it('an exception shares the template\'s UID and carries RECURRENCE-ID for the original slot, not its own new time', () => {
      const ics = buildIcsFeed([
        baseEntry({ uid: 'band-1:template-1', recurrence: { freq: 'weekly' } }),
        baseEntry({
          uid: 'band-1:template-1',
          title: 'Moved to a bigger room',
          startsAt: Date.parse('2026-09-17T19:00:00.000Z'), // moved an hour later
          recurrenceId: Date.parse('2026-09-17T18:00:00.000Z'), // the original slot
        }),
      ]);
      expect(ics.match(/UID:band-1:template-1/g)).toHaveLength(2);
      expect(ics).toContain('RECURRENCE-ID:20260917T180000Z');
      expect(ics).toContain('DTSTART:20260917T190000Z');
    });

    it('a cancelled exception still carries STATUS:CANCELLED, same as a plain cancelled event', () => {
      const ics = buildIcsFeed([
        baseEntry({
          uid: 'band-1:template-1',
          status: 'cancelled',
          recurrenceId: Date.parse('2026-09-17T18:00:00.000Z'),
        }),
      ]);
      expect(ics).toContain('STATUS:CANCELLED');
      expect(ics).toContain('RECURRENCE-ID:20260917T180000Z');
    });
  });
});
