// SPDX-License-Identifier: Apache-2.0

/** A subset of SeriesRule's freq values this module knows how to render as an RRULE. */
export type IcsRecurrenceFreq = 'weekly' | 'biweekly' | 'every4weeks' | 'monthly' | 'monthlyByWeekday';

export interface IcsFeedEntry {
  /**
   * Unique across the whole feed — a per-band occurrence id alone isn't,
   * once multiple bands are aggregated into one feed. A series exception
   * entry (`recurrenceId` set) shares its template's own uid rather than
   * having one of its own, per RFC 5545: an overridden occurrence is
   * addressed as "this UID, at this RECURRENCE-ID," not as an unrelated
   * event.
   */
  uid: string;
  bandName: string;
  title: string;
  startsAt: number;
  endsAt?: number;
  allDay: boolean;
  location?: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  /**
   * Present only on a series' template entry — emits an RRULE instead of a
   * one-off VEVENT, so a subscribed calendar app expands the series itself
   * rather than receiving one VEVENT per occurrence.
   */
  recurrence?: { freq: IcsRecurrenceFreq; until?: string };
  /**
   * Present only on a series exception's own VEVENT — the original,
   * template-generated instant this entry overrides (never the exception's
   * own, possibly different, startsAt). Mutually exclusive with
   * `recurrence`: an entry either defines a series or overrides one
   * occurrence of one, never both.
   */
  recurrenceId?: number;
}

function escapeIcsText(text: string): string {
  // A bare `\r` (not part of a `\r\n` pair, which the `\n` replace below
  // already turns into a literal `\n` marker) is a real line terminator to
  // many ICS parsers — left unescaped, it lets a crafted title/location
  // terminate the current property early and inject arbitrary following
  // lines into the feed.
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\r/g, '\\n')
    .replace(/\n/g, '\\n');
}

function formatIcsDateTime(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function formatIcsDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
}

const STATUS_TEXT: Record<IcsFeedEntry['status'], string> = {
  confirmed: 'CONFIRMED',
  tentative: 'TENTATIVE',
  cancelled: 'CANCELLED',
};

const ICS_WEEKDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * `every4weeks`/`monthlyByWeekday` map onto native RFC 5545 constructs
 * (FREQ=WEEKLY;INTERVAL=4 and FREQ=MONTHLY;BYDAY=<n><weekday>
 * respectively) — a real calendar client expands either correctly on its
 * own, the same weekday every time, without Bandstand pre-computing
 * individual dates. `monthly` (legacy, variable weekday) maps to plain
 * FREQ=MONTHLY, which defaults to the same day-of-month as DTSTART; RFC
 * 5545 skips a month where that day doesn't exist rather than clamping
 * into it like `eventSeries.ts`'s own expansion does; for the exports of
 * already-existing legacy series this is a documented, acceptable
 * difference, not a bug — clamping isn't expressible in a plain RRULE.
 */
function buildRRule(recurrence: NonNullable<IcsFeedEntry['recurrence']>, dtstartMs: number, allDay: boolean): string {
  const parts: string[] = [];
  if (recurrence.freq === 'weekly') {
    parts.push('FREQ=WEEKLY');
  } else if (recurrence.freq === 'biweekly') {
    parts.push('FREQ=WEEKLY', 'INTERVAL=2');
  } else if (recurrence.freq === 'every4weeks') {
    parts.push('FREQ=WEEKLY', 'INTERVAL=4');
  } else if (recurrence.freq === 'monthlyByWeekday') {
    const d = new Date(dtstartMs);
    const weekday = allDay ? d.getUTCDay() : d.getDay();
    const dayOfMonth = allDay ? d.getUTCDate() : d.getDate();
    const ordinal = Math.min(Math.ceil(dayOfMonth / 7), 4);
    parts.push('FREQ=MONTHLY', `BYDAY=${ordinal}${ICS_WEEKDAY[weekday]}`);
  } else {
    parts.push('FREQ=MONTHLY');
  }
  if (recurrence.until) {
    const untilDigits = recurrence.until.replace(/-/g, '');
    parts.push(`UNTIL=${allDay ? untilDigits : `${untilDigits}T235959Z`}`);
  }
  return parts.join(';');
}

/**
 * A minimal RFC 5545 subset — VEVENT with UID/DTSTAMP/DTSTART/DTEND/SUMMARY/
 * LOCATION/STATUS, no attendees/alarms/line-folding (most consumers
 * tolerate long lines; see docs/adr/0011-calendar-events.md). A cancelled
 * event is emitted with `STATUS:CANCELLED`, never omitted — a subscriber's
 * calendar app needs the cancellation to remove what it already cached,
 * and this feed has no way to "delete" an event it once sent.
 *
 * A recurring series is a single VEVENT carrying an RRULE (`recurrence`),
 * not one VEVENT per generated occurrence — a real calendar client expands
 * it on its own. An exception (a cancelled or modified single date) is its
 * own VEVENT sharing the template's UID, with RECURRENCE-ID naming the
 * original slot it overrides.
 */
export function buildIcsFeed(entries: IcsFeedEntry[], generatedAt: number = Date.now()): string {
  const dtstamp = formatIcsDateTime(generatedAt);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bandstand//Calendar//EN', 'CALSCALE:GREGORIAN'];

  for (const entry of entries) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${entry.uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    if (entry.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(entry.startsAt)}`);
      if (entry.endsAt !== undefined) lines.push(`DTEND;VALUE=DATE:${formatIcsDate(entry.endsAt)}`);
    } else {
      lines.push(`DTSTART:${formatIcsDateTime(entry.startsAt)}`);
      if (entry.endsAt !== undefined) lines.push(`DTEND:${formatIcsDateTime(entry.endsAt)}`);
    }
    if (entry.recurrenceId !== undefined) {
      lines.push(
        entry.allDay
          ? `RECURRENCE-ID;VALUE=DATE:${formatIcsDate(entry.recurrenceId)}`
          : `RECURRENCE-ID:${formatIcsDateTime(entry.recurrenceId)}`,
      );
    }
    lines.push(`SUMMARY:${escapeIcsText(`${entry.bandName}: ${entry.title}`)}`);
    if (entry.location) lines.push(`LOCATION:${escapeIcsText(entry.location)}`);
    lines.push(`STATUS:${STATUS_TEXT[entry.status]}`);
    if (entry.recurrence) lines.push(`RRULE:${buildRRule(entry.recurrence, entry.startsAt, entry.allDay)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
