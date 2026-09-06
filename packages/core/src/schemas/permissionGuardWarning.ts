// SPDX-License-Identifier: Apache-2.0
//
// The response shape for GET /bands/:bandId/permission-guard-warnings
// (issue #48) — a client-originated attempt to delete a songs/setlists map
// entry that apps/server/src/lib/hocuspocus.ts's onChange guard reverted.
import { z } from 'zod';

export const permissionGuardWarningSchema = z.object({
  id: z.string(),
  mapName: z.string(),
  key: z.string(),
  actingUserName: z.string().nullable(),
  createdAt: z.string(),
});
export type PermissionGuardWarning = z.infer<typeof permissionGuardWarningSchema>;
