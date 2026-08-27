// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { isForeignKeyViolation, isUniqueViolation } from './pgErrors';

describe('isUniqueViolation', () => {
  it('matches a raw pg error with the code directly on it', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('matches a drizzle-orm DrizzleQueryError, which nests the real pg error under .cause', () => {
    expect(isUniqueViolation({ message: 'Failed query: ...', cause: { code: '23505' } })).toBe(true);
  });

  it('does not match a different code, wrapped or not', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation({ cause: { code: '23503' } })).toBe(false);
  });

  it('does not match a non-error value', () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('boom')).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});

describe('isForeignKeyViolation', () => {
  it('matches a raw pg error with the code directly on it', () => {
    expect(isForeignKeyViolation({ code: '23503' })).toBe(true);
  });

  it('matches through a drizzle-orm DrizzleQueryError wrapper', () => {
    expect(isForeignKeyViolation({ message: 'Failed query: ...', cause: { code: '23503' } })).toBe(true);
  });

  it('matches through a doubly-wrapped cause chain', () => {
    expect(isForeignKeyViolation({ cause: { cause: { code: '23503' } } })).toBe(true);
  });

  it('does not match a different code or a non-error value', () => {
    expect(isForeignKeyViolation({ code: '23505' })).toBe(false);
    expect(isForeignKeyViolation(null)).toBe(false);
  });
});
