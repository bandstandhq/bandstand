// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `pnpm push:due` — the two time-based reminders from docs/adr/0012-web-
// push.md: a missing-response nudge (3 days before an event a member
// hasn't answered) and a pre-event reminder (1 hour before). Meant to run
// hourly via cron (see docs/SELF_HOSTING.md); each reminder fires once per
// (user, occurrence) — push_reminder_log is the dedup marker so a rerun
// within the same firing window never resends it.
import { resolveEventOccurrences } from '@bandstand/core';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { bandDocs, bandMembers, pushReminderLog } from '../db/schema/index';
import { sendPushToUser } from './send';

const HOUR_MS = 1000 * 60 * 60;
const MISSING_RESPONSE_LEAD_MS = 1000 * 60 * 60 * 24 * 3;
const UPCOMING_EVENT_LEAD_MS = HOUR_MS;
// Matches the hourly cron cadence this script is meant to run at — wide
// enough that a run a few minutes late or early still catches each
// occurrence's one firing window, narrow enough that it fires once, not
// on every run for hours.
const FIRING_WINDOW_MS = HOUR_MS;

async function alreadySent(userId: string, reminderKey: string): Promise<boolean> {
  const [existing] = await db
    .select({ userId: pushReminderLog.userId })
    .from(pushReminderLog)
    .where(and(eq(pushReminderLog.userId, userId), eq(pushReminderLog.reminderKey, reminderKey)));
  return existing !== undefined;
}

async function markSent(userId: string, reminderKey: string): Promise<void> {
  await db.insert(pushReminderLog).values({ userId, reminderKey }).onConflictDoNothing();
}

export async function runPushDue(): Promise<{
  missingResponseSent: number;
  upcomingEventSent: number;
}> {
  const now = Date.now();
  let missingResponseSent = 0;
  let upcomingEventSent = 0;

  const bands = await db
    .select({ bandId: bandDocs.bandId, snapshot: bandDocs.snapshot })
    .from(bandDocs);

  for (const { bandId, snapshot } of bands) {
    if (!snapshot) continue;
    const events = snapshot.events ?? {};
    const availability = snapshot.availability ?? {};
    const members = await db
      .select({ userId: bandMembers.userId })
      .from(bandMembers)
      .where(eq(bandMembers.bandId, bandId));

    const missingResponseWindow = resolveEventOccurrences(
      events,
      now + MISSING_RESPONSE_LEAD_MS - FIRING_WINDOW_MS,
      now + MISSING_RESPONSE_LEAD_MS,
    );
    const upcomingWindow = resolveEventOccurrences(events, now, now + UPCOMING_EVENT_LEAD_MS);

    for (const { userId } of members) {
      for (const occ of missingResponseWindow) {
        if (occ.event.status === 'cancelled') continue;
        if (availability[`${occ.occurrenceId}:${userId}`] !== undefined) continue;
        const reminderKey = `missing-response:${occ.occurrenceId}`;
        if (await alreadySent(userId, reminderKey)) continue;
        await sendPushToUser(userId, 'missingResponseReminder', {
          title: "You haven't answered yet",
          body: occ.event.title,
          url: `/bands/${bandId}/calendar/${occ.occurrenceId}`,
        });
        await markSent(userId, reminderKey);
        missingResponseSent++;
      }

      for (const occ of upcomingWindow) {
        if (occ.event.status === 'cancelled') continue;
        const reminderKey = `upcoming-event:${occ.occurrenceId}`;
        if (await alreadySent(userId, reminderKey)) continue;
        await sendPushToUser(userId, 'upcomingEventReminder', {
          title: 'Coming up soon',
          body: occ.event.title,
          url: `/bands/${bandId}/calendar/${occ.occurrenceId}`,
        });
        await markSent(userId, reminderKey);
        upcomingEventSent++;
      }
    }
  }

  console.log(
    `push:due — sent ${missingResponseSent} missing-response reminder(s), ${upcomingEventSent} upcoming-event reminder(s)`,
  );
  return { missingResponseSent, upcomingEventSent };
}

// Only run as a CLI when invoked directly (`pnpm push:due`), not when
// imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  runPushDue()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
