// SPDX-License-Identifier: Apache-2.0
//
// Pure — resolves a recurring event's `seriesRule` into concrete occurrences
// within a date range, matching exceptions in along the way. Never touches
// a Y.Doc; takes exactly the plain shape `yDocToSnapshot`/`listEvents`
// already produce. See docs/adr/0011-calendar-events.md.
import type { CalendarEvent, SeriesRule } from '../schemas/event';

export interface ResolvedOccurrence {
  /** A real `events` key for a plain event or a series exception; a synthetic `${templateId}@<isoDate>` id for a virtual (never materialized) occurrence. */
  occurrenceId: string;
  /** The ISO calendar date this occurrence falls on — also the exception-matching key. */
  date: string;
  event: CalendarEvent;
}

// A recurring series with no `until` must still terminate — see the ADR's
// "expansion needs a hard cap" note. Two years past the later of the
// caller's own `rangeStart` or the series' own `startsAt`, or 200 generated
// occurrences, whichever comes first — enforced here regardless of how wide
// a range a caller asks for.
const MAX_SERIES_SPAN_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const MAX_SERIES_OCCURRENCES = 200;

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The day-of-month of the `ordinal`-th `weekday` in `year`/`month` (0-indexed
 * month, 0=Sunday..6=Saturday) — e.g. ordinal=2, weekday=Tuesday gives the
 * date of the second Tuesday. `ordinal` is clamped down to the last
 * occurrence in the month if the month doesn't have that many (only ever
 * matters for ordinal 5, since every month has at least four of any given
 * weekday) — a start date that happened to fall on a rare fifth occurrence
 * still generates something every following month, rather than skipping
 * short months entirely.
 */
function nthWeekdayOfMonthDay(year: number, month: number, weekday: number, ordinal: number): number {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const firstOccurrence = 1 + ((weekday - firstWeekday + 7) % 7);
  const day = firstOccurrence + (ordinal - 1) * 7;
  return day > daysInMonth ? day - 7 : day;
}

/**
 * Which occurrence-of-the-month `date` is, for its own weekday — the true
 * ordinal (up to 5), never pre-clamped to 4: clamping here too, on top of
 * `nthWeekdayOfMonthDay`'s own clamp for a target month that's too short,
 * would make `n=0` (the template's own start date, in its own month) land
 * on the wrong day whenever that start date was itself the month's fifth
 * occurrence of its weekday.
 */
function ordinalOfWeekdayInMonth(date: Date): number {
  return Math.ceil(date.getUTCDate() / 7);
}

function advanceByN(startMs: number, freq: SeriesRule['freq'], n: number): number {
  const date = new Date(startMs);
  if (freq === 'weekly') {
    date.setUTCDate(date.getUTCDate() + 7 * n);
  } else if (freq === 'biweekly') {
    date.setUTCDate(date.getUTCDate() + 14 * n);
  } else if (freq === 'every4weeks') {
    date.setUTCDate(date.getUTCDate() + 28 * n);
  } else if (freq === 'monthlyByWeekday') {
    const weekday = date.getUTCDay();
    const ordinal = ordinalOfWeekdayInMonth(date);
    const targetMonth = date.getUTCMonth() + n;
    const day = nthWeekdayOfMonthDay(date.getUTCFullYear(), targetMonth, weekday, ordinal);
    date.setUTCFullYear(date.getUTCFullYear(), targetMonth, day);
  } else {
    // Legacy 'monthly' — setUTCMonth on a date whose day-of-month doesn't
    // exist in the target month rolls forward into the month after (e.g.
    // Jan 31 + 1 "month" lands on Mar 3, skipping February's 28 days
    // entirely) — clamping to the target month's last day instead keeps
    // every occurrence in the month it was actually meant to land in.
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + n);
    const lastDayOfTargetMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  }
  return date.getTime();
}

/**
 * The smallest `n >= 0` with `advanceByN(startMs, freq, n) >= targetMs`.
 * Jumps to a direct estimate first (so a target far in the future costs one
 * division, not thousands of one-step iterations), then makes a small,
 * bounded correction for monthly's variable day count — weekly/biweekly/
 * every4weeks are exact, so that correction loop runs zero times for them.
 */
function firstOccurrenceIndexAtOrAfter(startMs: number, freq: SeriesRule['freq'], targetMs: number): number {
  if (targetMs <= startMs) return 0;
  const estimateIntervalMs = freq === 'weekly' ? 7 : freq === 'biweekly' ? 14 : freq === 'every4weeks' ? 28 : 30.44;
  let n = Math.max(0, Math.floor((targetMs - startMs) / (estimateIntervalMs * 86_400_000)));
  while (n > 0 && advanceByN(startMs, freq, n) >= targetMs) n--;
  while (advanceByN(startMs, freq, n) < targetMs) n++;
  return n;
}

/**
 * Expands every event in `events` into the concrete occurrences that fall
 * within `[rangeStart, rangeEnd]` (both epoch milliseconds) — a plain event
 * is included as-is if its `startsAt` falls in range; a series template is
 * walked forward from its first in-range date, checked against any matching
 * exception at each generated date (decision: an exception's own real id
 * and data wins; a `status: 'cancelled'` exception suppresses that date
 * entirely; no exception means a virtual occurrence is synthesized from the
 * template, never mutating it). An exception entry is never itself iterated
 * as a standalone event (it's only surfaced via its template's walk) — an
 * orphaned exception whose template no longer exists is simply omitted,
 * not resurrected as a phantom event.
 */
export function resolveEventOccurrences(
  events: Record<string, CalendarEvent>,
  rangeStart: number,
  rangeEnd: number,
): ResolvedOccurrence[] {
  const exceptionsBySeriesAndDate = new Map<string, { id: string; event: CalendarEvent }>();
  for (const [id, event] of Object.entries(events)) {
    if (event.seriesId && event.occurrenceDate) {
      exceptionsBySeriesAndDate.set(`${event.seriesId}:${event.occurrenceDate}`, { id, event });
    }
  }

  const results: ResolvedOccurrence[] = [];

  for (const [id, event] of Object.entries(events)) {
    if (event.occurrenceDate) continue; // an exception — only ever surfaced via its template's walk below.

    if (!event.seriesRule) {
      if (event.startsAt >= rangeStart && event.startsAt <= rangeEnd) {
        results.push({ occurrenceId: id, date: toIsoDate(event.startsAt), event });
      }
      continue;
    }

    const durationMs = event.endsAt !== undefined ? event.endsAt - event.startsAt : undefined;
    const untilMs = event.seriesRule.until ? Date.parse(`${event.seriesRule.until}T23:59:59.999Z`) : undefined;
    const effectiveRangeStart = Math.max(rangeStart, event.startsAt);
    const capMs = effectiveRangeStart + MAX_SERIES_SPAN_MS;

    const startIndex = firstOccurrenceIndexAtOrAfter(event.startsAt, event.seriesRule.freq, effectiveRangeStart);

    for (let n = startIndex; n < startIndex + MAX_SERIES_OCCURRENCES; n++) {
      const occurrenceMs = advanceByN(event.startsAt, event.seriesRule.freq, n);
      if (occurrenceMs > rangeEnd || occurrenceMs > capMs) break;
      if (untilMs !== undefined && occurrenceMs > untilMs) break;

      const occurrenceDate = toIsoDate(occurrenceMs);
      const exception = exceptionsBySeriesAndDate.get(`${id}:${occurrenceDate}`);
      if (exception) {
        if (exception.event.status !== 'cancelled') {
          results.push({ occurrenceId: exception.id, date: occurrenceDate, event: exception.event });
        }
        continue;
      }

      results.push({
        occurrenceId: `${id}@${occurrenceDate}`,
        date: occurrenceDate,
        event: {
          ...event,
          startsAt: occurrenceMs,
          endsAt: durationMs !== undefined ? occurrenceMs + durationMs : undefined,
        },
      });
    }
  }

  return results.sort((a, b) => a.event.startsAt - b.event.startsAt);
}

/**
 * Resolves a single occurrence id (a real `events` key, or a virtual
 * occurrence's synthetic `${templateId}@<date>` id) back to its effective
 * event data — for a detail page that only has the id from its own URL.
 * A real entry is a direct lookup; a virtual one is resolved by narrowing
 * `resolveEventOccurrences` to just that one date, so it goes through
 * exactly the same exception-matching logic as everywhere else rather than
 * a second, parallel implementation of it.
 */
export function findOccurrenceEvent(events: Record<string, CalendarEvent>, occurrenceId: string): CalendarEvent | undefined {
  const direct = events[occurrenceId];
  if (direct) return direct;

  const atIndex = occurrenceId.lastIndexOf('@');
  if (atIndex === -1) return undefined;
  const date = occurrenceId.slice(atIndex + 1);
  const dayStart = Date.parse(`${date}T00:00:00.000Z`);
  const dayEnd = Date.parse(`${date}T23:59:59.999Z`);
  if (Number.isNaN(dayStart)) return undefined;

  return resolveEventOccurrences(events, dayStart, dayEnd).find((o) => o.occurrenceId === occurrenceId)?.event;
}

/**
 * The template-generated (unmodified) start time for the occurrence dated
 * `occurrenceDate` — what an exception's ICS export must reference via
 * RECURRENCE-ID, per RFC 5545: that field names the original slot being
 * overridden, not whatever new time the override itself carries (a moved
 * rehearsal keeps DTSTART at the new time but RECURRENCE-ID at the old one,
 * so a calendar client can tell which generated instance to replace).
 * Undefined if `occurrenceDate` doesn't actually fall on one of the
 * template's own generated dates — a data inconsistency the caller should
 * skip, not synthesize a guess for.
 */
export function resolveTemplateGeneratedStartsAt(template: CalendarEvent, occurrenceDate: string): number | undefined {
  if (!template.seriesRule) return undefined;
  const dayStart = Date.parse(`${occurrenceDate}T00:00:00.000Z`);
  if (Number.isNaN(dayStart)) return undefined;
  const n = firstOccurrenceIndexAtOrAfter(template.startsAt, template.seriesRule.freq, dayStart);
  const candidate = advanceByN(template.startsAt, template.seriesRule.freq, n);
  return toIsoDate(candidate) === occurrenceDate ? candidate : undefined;
}
