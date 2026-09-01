// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { ARCHIVE_GRACE_PERIOD_MS, permanentDeletionAt } from './archive';

describe('permanentDeletionAt', () => {
  it('is exactly 30 days after archivedAt', () => {
    const archivedAt = Date.parse('2026-01-01T00:00:00.000Z');
    expect(permanentDeletionAt(archivedAt)).toBe(archivedAt + ARCHIVE_GRACE_PERIOD_MS);
    expect(new Date(permanentDeletionAt(archivedAt)).toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });
});
