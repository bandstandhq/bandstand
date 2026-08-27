// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A read-only calendar subscription feed, authenticated purely by a secret
// token in the URL — there is no session on a calendar app's HTTP client
// (mounted with no requireAuth). See docs/adr/0011-calendar-events.md.
import { buildIcsFeed, type IcsFeedEntry, resolveEventOccurrences } from '@bandstand/core';
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
    const events = docRow?.snapshot?.events ?? {};
    const occurrences = resolveEventOccurrences(events, now - PAST_WINDOW_MS, now + FUTURE_WINDOW_MS);
    for (const occ of occurrences) {
      entries.push({
        uid: `${bandId}:${occ.occurrenceId}@bandstand`,
        bandName,
        title: occ.event.title,
        startsAt: occ.event.startsAt,
        endsAt: occ.event.endsAt,
        allDay: occ.event.allDay,
        location: occ.event.location,
        status: occ.event.status,
      });
    }
  }

  const ics = buildIcsFeed(entries, now);
  return c.text(ics, 200, { 'Content-Type': 'text/calendar; charset=utf-8' });
});
