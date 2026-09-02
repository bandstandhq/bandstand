// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A plain unit test for assertNotProduction() only — main() itself hits a
// real Postgres and real MinIO, which isn't restructured for testability
// here (see the PR that added this file).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertNotProduction } from './index';

describe('assertNotProduction', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSeedForce = process.env.SEED_FORCE;

  beforeEach(() => {
    delete process.env.SEED_FORCE;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalSeedForce === undefined) delete process.env.SEED_FORCE;
    else process.env.SEED_FORCE = originalSeedForce;
  });

  it('throws when NODE_ENV is production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertNotProduction()).toThrow('must never run against a non-development database');
  });

  it('throws when NODE_ENV is unset — the real shape of `pnpm start`, not just the literal "production" value', () => {
    delete process.env.NODE_ENV;
    expect(() => assertNotProduction()).toThrow('must never run against a non-development database');
  });

  it('does not throw when NODE_ENV is production and SEED_FORCE carries the exact override value', () => {
    process.env.NODE_ENV = 'production';
    process.env.SEED_FORCE = 'i-know-what-im-doing';
    expect(() => assertNotProduction()).not.toThrow();
  });

  it('still throws when SEED_FORCE is set to anything other than the exact override value', () => {
    process.env.NODE_ENV = 'production';
    process.env.SEED_FORCE = 'yes';
    expect(() => assertNotProduction()).toThrow();
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
