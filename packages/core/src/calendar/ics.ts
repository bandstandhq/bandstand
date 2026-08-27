// SPDX-License-Identifier: Apache-2.0

export interface IcsFeedEntry {
  /** Unique across the whole feed — a per-band occurrence id alone isn't, once multiple bands are aggregated into one feed. */
  uid: string;
  bandName: string;
  title: string;
  startsAt: number;
  endsAt?: number;
  allDay: boolean;
  location?: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
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

/**
 * A minimal RFC 5545 subset — VEVENT with UID/DTSTAMP/DTSTART/DTEND/SUMMARY/
 * LOCATION/STATUS, no attendees/alarms/line-folding (most consumers
 * tolerate long lines; see docs/adr/0011-calendar-events.md). A cancelled
 * event is emitted with `STATUS:CANCELLED`, never omitted — a subscriber's
 * calendar app needs the cancellation to remove what it already cached,
 * and this feed has no way to "delete" an event it once sent.
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
    lines.push(`SUMMARY:${escapeIcsText(`${entry.bandName}: ${entry.title}`)}`);
    if (entry.location) lines.push(`LOCATION:${escapeIcsText(entry.location)}`);
    lines.push(`STATUS:${STATUS_TEXT[entry.status]}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
