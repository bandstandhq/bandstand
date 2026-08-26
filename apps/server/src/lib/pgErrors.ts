// SPDX-License-Identifier: AGPL-3.0-or-later

/** drizzle-orm wraps a failed query in its own `DrizzleQueryError`, with the raw pg error (the one that actually carries `.code`) on `.cause` rather than on the error itself. */
function pgErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const code = (err as { code?: string }).code;
  if (code) return code;
  return pgErrorCode((err as { cause?: unknown }).cause);
}

/** Postgres error code 23505 = unique_violation. */
export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === '23505';
}

/** Postgres error code 23503 = foreign_key_violation. */
export function isForeignKeyViolation(err: unknown): boolean {
  return pgErrorCode(err) === '23503';
}
