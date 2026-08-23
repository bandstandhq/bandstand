// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

export const themeSchema = z.enum(['dark', 'light']);
export type Theme = z.infer<typeof themeSchema>;

// The four Stage Mode text sizes from the brief.
export const textSizeSchema = z.enum(['small', 'medium', 'large', 'xlarge']);
export type TextSize = z.infer<typeof textSizeSchema>;

export const userPrefsSchema = z.object({
  // Applies to every song for this user; view-only, never written back to
  // the song's stored key (see docs/ARCHITECTURE.md).
  personalTranspose: z.number().int(),
  theme: themeSchema,
  textSize: textSizeSchema,
  boldText: z.boolean(),
  chordColor: z.string().min(1),
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
};
