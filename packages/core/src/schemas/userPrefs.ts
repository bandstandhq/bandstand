// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

export const themeSchema = z.enum(['dark', 'light']);
export type Theme = z.infer<typeof themeSchema>;

// The four Stage Mode text sizes from the brief.
export const textSizeSchema = z.enum(['small', 'medium', 'large', 'xlarge']);
export type TextSize = z.infer<typeof textSizeSchema>;

// Always list below the board breakpoint regardless of this — see the
// brief's "Listenansicht ... auf Mobilgeräten immer".
export const setlistViewModeSchema = z.enum(['board', 'list']);
export type SetlistViewMode = z.infer<typeof setlistViewModeSchema>;

// Stage Mode's content visibility toggle from the brief.
export const contentVisibilitySchema = z.enum(['text', 'chords', 'both']);
export type ContentVisibility = z.infer<typeof contentVisibilitySchema>;

export const songChecklistItemSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  done: z.boolean(),
});
export type SongChecklistItem = z.infer<typeof songChecklistItemSchema>;

// Personal to this user for one song — private setup notes and a setup
// checklist (e.g. "capo 2", "tune down half step"). Lives in user_prefs,
// never in the band's Yjs doc, so it's never visible to bandmates.
export const songNoteSchema = z.object({
  notes: z.string(),
  checklist: z.array(songChecklistItemSchema),
});
export type SongNote = z.infer<typeof songNoteSchema>;

export const userPrefsSchema = z.object({
  // Applies to every song for this user; view-only, never written back to
  // the song's stored key (see docs/ARCHITECTURE.md).
  personalTranspose: z.number().int(),
  theme: themeSchema,
  textSize: textSizeSchema,
  boldText: z.boolean(),
  chordColor: z.string().min(1),
  setlistViewMode: setlistViewModeSchema,
  contentVisibility: contentVisibilitySchema,
  // Keyed by songId.
  songNotes: z.record(z.string(), songNoteSchema),
});
export type UserPrefs = z.infer<typeof userPrefsSchema>;

export const updateUserPrefsInputSchema = userPrefsSchema.partial();
export type UpdateUserPrefsInput = z.infer<typeof updateUserPrefsInputSchema>;

export const DEFAULT_USER_PREFS: UserPrefs = {
  personalTranspose: 0,
  theme: 'dark',
  textSize: 'medium',
  boldText: false,
  chordColor: '#3b82f6',
  setlistViewMode: 'list',
  contentVisibility: 'both',
  songNotes: {},
};
