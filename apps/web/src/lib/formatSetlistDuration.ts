// SPDX-License-Identifier: Apache-2.0

/** Shared by SetlistList's cards and SetlistDetail's read view stats line. */
export function formatSetlistDuration(t: (key: string, opts?: Record<string, unknown>) => string, totalSec: number): string {
  return t('setlistList.durationMinutes', { minutes: Math.round(totalSec / 60) });
}
