// SPDX-License-Identifier: AGPL-3.0-or-later
import { boolean, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const userPrefs = pgTable('user_prefs', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  personalTranspose: integer('personal_transpose').notNull().default(0),
  // 'dark' | 'light'; 'small' | 'medium' | 'large' | 'xlarge' — the four
  // Stage Mode text sizes from the brief. Validated in packages/core's
  // userPrefsSchema, not with a pg enum, to keep adding a size a
  // one-file change.
  theme: text('theme').notNull().default('dark'),
  textSize: text('text_size').notNull().default('medium'),
  boldText: boolean('bold_text').notNull().default(false),
  chordColor: text('chord_color').notNull().default('#3b82f6'),
  // 'board' | 'list' — always list below the board breakpoint regardless
  // of this, per the brief; validated in packages/core's userPrefsSchema.
  setlistViewMode: text('setlist_view_mode').notNull().default('list'),
  // 'text' | 'chords' | 'both' — Stage Mode's content visibility toggle;
  // validated in packages/core's userPrefsSchema.
  contentVisibility: text('content_visibility').notNull().default('both'),
  // Keyed by songId: { notes: string; checklist: {id,text,done}[] } — never
  // synced to bandmates (that's the whole reason this lives here and not
  // in the band's Yjs doc); validated in packages/core's userPrefsSchema.
  songNotes: jsonb('song_notes').notNull().default({}),
  // { eventCreated, eventChanged, pollCreated, missingResponseReminder,
  // upcomingEventReminder }, all false by default (see docs/adr/0012-web-
  // push.md) — validated in packages/core's pushTriggersSchema.
  pushTriggers: jsonb('push_triggers').notNull().default({
    eventCreated: false,
    eventChanged: false,
    pollCreated: false,
    missingResponseReminder: false,
    upcomingEventReminder: false,
  }),
});
