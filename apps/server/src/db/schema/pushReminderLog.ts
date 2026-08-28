// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Dedup marker for push/due.ts's two time-based reminders — without this,
// an hourly rerun would resend the same reminder on every run within its
// firing window, not just once. `reminderKey` is `<type>:<occurrenceId>`
// (e.g. `missing-response:abcd@2026-09-01`); the unique constraint on
// (userId, reminderKey) is what actually prevents the duplicate, the row
// existing at all is the only thing that matters — `sentAt` is for
// debugging, not read back by the script itself.
import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const pushReminderLog = pgTable(
  'push_reminder_log',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reminderKey: text('reminder_key').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.reminderKey] })],
);
