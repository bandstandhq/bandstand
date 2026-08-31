// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A read-only calendar subscription feed, authenticated purely by a secret
// token in the URL — there is no session on a calendar app's HTTP client
// (mounted with no requireAuth). See docs/adr/0011-calendar-events.md.
import { buildIcsFeed, type CalendarEvent, type IcsFeedEntry, resolveTemplateGeneratedStartsAt } from '@bandstand/core';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { bandDocs, bandMembers, bands, icsFeedTokens } from '../db/schema/index';
import { clientIp, createRateLimiter } from '../lib/rateLimit';

export const calendarFeedRoute = new Hono();

// Same in-memory, single-instance limiter routes/invites.ts already uses —
// generous enough for a calendar app's normal periodic polling, tight
// enough to slow down brute-force token guessing.
const feedRateLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

const PAST_WINDOW_MS = 1000 * 60 * 60 * 24 * 30;
const FUTURE_WINDOW_MS = 1000 * 60 * 60 * 24 * 365;

calendarFeedRoute.get('/:tokenFile', feedRateLimiter(clientIp), async (c) => {
  const tokenFile = c.req.param('tokenFile');
  if (!tokenFile.endsWith('.ics')) return c.text('Not found', 404);
  const token = tokenFile.slice(0, -'.ics'.length);

  const [tokenRow] = await db.select({ userId: icsFeedTokens.userId }).from(icsFeedTokens).where(eq(icsFeedTokens.token, token));
  if (!tokenRow) return c.text('Not found', 404);

  // Membership is rechecked fresh on every single request, never cached or
  // resolved once at token-issue time — a calendar app polls this exact
  // URL indefinitely, including long after the person may have left every
  // band it could ever have covered. This is the only correct check for
  // that reason, not an optimization opportunity: it must never be
  // replaced with a cached join keyed by token alone.
  const memberships = await db
    .select({ bandId: bands.id, bandName: bands.name })
    .from(bandMembers)
    .innerJoin(bands, eq(bandMembers.bandId, bands.id))
    .where(eq(bandMembers.userId, tokenRow.userId));

  const now = Date.now();
  const entries: IcsFeedEntry[] = [];
  for (const { bandId, bandName } of memberships) {
    const [docRow] = await db.select({ snapshot: bandDocs.snapshot }).from(bandDocs).where(eq(bandDocs.bandId, bandId));
    const events: Record<string, CalendarEvent> = docRow?.snapshot?.events ?? {};

    const exceptionsByTemplateId = new Map<string, CalendarEvent[]>();
    for (const event of Object.values(events)) {
      if (event.seriesId && event.occurrenceDate) {
        const list = exceptionsByTemplateId.get(event.seriesId) ?? [];
        list.push(event);
        exceptionsByTemplateId.set(event.seriesId, list);
      }
    }

    for (const [id, event] of Object.entries(events)) {
      if (event.occurrenceDate) continue; // an exception — emitted below, alongside its template.

      if (!event.seriesRule) {
        // A plain, non-recurring event — still windowed, since there's no
        // RRULE to let a client bound this on its own.
        if (event.startsAt < now - PAST_WINDOW_MS || event.startsAt > now + FUTURE_WINDOW_MS) continue;
        entries.push({
          uid: `${bandId}:${id}@bandstand`,
          bandName,
          title: event.title,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          allDay: event.allDay,
          location: event.location,
          status: event.status,
        });
        continue;
      }

      // A series template — skip only if it's definitively over (an
      // `until` already in the past); an indefinite or still-active series
      // is always included, since its own RRULE is what bounds it for the
      // subscribing client, not this feed's window.
      const untilMs = event.seriesRule.until ? Date.parse(`${event.seriesRule.until}T23:59:59.999Z`) : undefined;
      if (untilMs !== undefined && untilMs < now - PAST_WINDOW_MS) continue;

      const templateUid = `${bandId}:${id}@bandstand`;
      entries.push({
        uid: templateUid,
        bandName,
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: event.allDay,
        location: event.location,
        status: event.status,
        recurrence: { freq: event.seriesRule.freq, until: event.seriesRule.until },
      });

      for (const exception of exceptionsByTemplateId.get(id) ?? []) {
        if (exception.startsAt < now - PAST_WINDOW_MS || exception.startsAt > now + FUTURE_WINDOW_MS) continue;
        const recurrenceId = resolveTemplateGeneratedStartsAt(event, exception.occurrenceDate!);
        if (recurrenceId === undefined) continue; // orphaned/inconsistent data — omit rather than guess.
        entries.push({
          uid: templateUid,
          bandName,
          title: exception.title,
          startsAt: exception.startsAt,
          endsAt: exception.endsAt,
          allDay: exception.allDay,
          location: exception.location,
          status: exception.status,
          recurrenceId,
        });
      }
    }
  }

  const ics = buildIcsFeed(entries, now);
  return c.text(ics, 200, { 'Content-Type': 'text/calendar; charset=utf-8' });
});
