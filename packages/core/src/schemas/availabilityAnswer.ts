// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

// Shared by a member's per-event availability response and a per-option
// scheduling-poll vote — same three-value shape, same "always for yourself,
// never someone else's" rule (see docs/PERMISSIONS.md and
// docs/adr/0011-calendar-events.md).
export const availabilityAnswerSchema = z.enum(['yes', 'maybe', 'no']);

export type AvailabilityAnswer = z.infer<typeof availabilityAnswerSchema>;
