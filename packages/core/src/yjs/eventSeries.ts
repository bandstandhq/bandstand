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

function advanceByN(startMs: number, freq: SeriesRule['freq'], n: number): number {
  const date = new Date(startMs);
  if (freq === 'weekly') date.setUTCDate(date.getUTCDate() + 7 * n);
  else if (freq === 'biweekly') date.setUTCDate(date.getUTCDate() + 14 * n);
  else date.setUTCMonth(date.getUTCMonth() + n);
  return date.getTime();
}

/**
 * The smallest `n >= 0` with `advanceByN(startMs, freq, n) >= targetMs`.
 * Jumps to a direct estimate first (so a target far in the future costs one
 * division, not thousands of one-step iterations), then makes a small,
 * bounded correction for monthly's variable day count — weekly/biweekly are
 * exact, so that correction loop runs zero times for them.
 */
function firstOccurrenceIndexAtOrAfter(startMs: number, freq: SeriesRule['freq'], targetMs: number): number {
  if (targetMs <= startMs) return 0;
  const estimateIntervalMs = freq === 'weekly' ? 7 : freq === 'biweekly' ? 14 : 30.44;
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
