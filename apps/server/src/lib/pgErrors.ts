// SPDX-License-Identifier: AGPL-3.0-or-later

/** Postgres error code 23505 = unique_violation. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
