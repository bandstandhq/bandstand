// SPDX-License-Identifier: Apache-2.0

// A band slated for deletion is archived first, not deleted outright — the
// owner can restore it any time before this elapses (see
// apps/server/src/routes/bands.ts's DELETE route and
// apps/server/src/bands/sweepArchived.ts, the cron job that actually
// removes it once the grace period is up). Shared here so the server route,
// the sweeper, and the web UI's own countdown all agree on the same window.
export const ARCHIVE_GRACE_PERIOD_MS = 1000 * 60 * 60 * 24 * 30;

export function permanentDeletionAt(archivedAt: number): number {
  return archivedAt + ARCHIVE_GRACE_PERIOD_MS;
}
