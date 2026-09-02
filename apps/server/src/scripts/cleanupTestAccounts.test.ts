// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A plain unit test for assertNotProduction() only — cleanupTestAccounts() itself hits a real
// Postgres, which isn't restructured for testability here (see seed/index.test.ts for the same
// pattern applied to that script's own guard).
import { afterEach, describe, expect, it } from 'vitest';
import { assertNotProduction } from './cleanupTestAccounts';

describe('assertNotProduction', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('throws when NODE_ENV is production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertNotProduction()).toThrow('must never run against a non-development database');
  });

  it('throws when NODE_ENV is unset — the real shape of a bare `tsx` invocation, not just the literal "production" value', () => {
    delete process.env.NODE_ENV;
    expect(() => assertNotProduction()).toThrow('must never run against a non-development database');
  });

  it('does not throw when NODE_ENV is development', () => {
    process.env.NODE_ENV = 'development';
    expect(() => assertNotProduction()).not.toThrow();
  });

  it('does not throw when NODE_ENV is test', () => {
    process.env.NODE_ENV = 'test';
    expect(() => assertNotProduction()).not.toThrow();
  });
});
