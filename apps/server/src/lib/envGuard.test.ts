// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertNotDevPlaceholder, assertStrongSecret, assertWebOriginIsRestricted } from './envGuard';

describe('assertNotDevPlaceholder', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  // The actual regression case: this used to pass (no exit) because the old
  // guard only fired under NODE_ENV=production, and the realistic
  // self-hosting path (`pnpm start`, no NODE_ENV set at all) never set it.
  it('exits when NODE_ENV is unset and the value still matches the placeholder', () => {
    delete process.env.NODE_ENV;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assertNotDevPlaceholder('MINIO_ACCESS_KEY', 'dev-only-changeme', 'dev-only-changeme');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when NODE_ENV is production and the value still matches the placeholder', () => {
    process.env.NODE_ENV = 'production';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assertNotDevPlaceholder('MINIO_ACCESS_KEY', 'dev-only-changeme', 'dev-only-changeme');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not exit when the value was actually changed, regardless of NODE_ENV', () => {
    delete process.env.NODE_ENV;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    assertNotDevPlaceholder('MINIO_ACCESS_KEY', 'a-real-secret', 'dev-only-changeme');

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not exit when NODE_ENV=development, even if the placeholder is still set', () => {
    process.env.NODE_ENV = 'development';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    assertNotDevPlaceholder('MINIO_ACCESS_KEY', 'dev-only-changeme', 'dev-only-changeme');

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not exit when NODE_ENV=test, even if the placeholder is still set', () => {
    process.env.NODE_ENV = 'test';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    assertNotDevPlaceholder('MINIO_ACCESS_KEY', 'dev-only-changeme', 'dev-only-changeme');

    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe('assertStrongSecret', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it('exits when the secret is missing entirely and NODE_ENV is unset', () => {
    delete process.env.NODE_ENV;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assertStrongSecret('BETTER_AUTH_SECRET', undefined);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when the secret is shorter than the minimum length and NODE_ENV is unset', () => {
    delete process.env.NODE_ENV;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assertStrongSecret('BETTER_AUTH_SECRET', 'too-short');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not exit for a secret at least 32 characters long', () => {
    delete process.env.NODE_ENV;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    assertStrongSecret('BETTER_AUTH_SECRET', 'a'.repeat(32));

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not exit when NODE_ENV=development, even with no secret at all', () => {
    process.env.NODE_ENV = 'development';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    assertStrongSecret('BETTER_AUTH_SECRET', undefined);

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('respects a custom minimum length', () => {
    delete process.env.NODE_ENV;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assertStrongSecret('SOME_SECRET', 'a'.repeat(10), 16);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('assertWebOriginIsRestricted', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it('does not exit when NODE_ENV=development, even for a wildcard, a list, or a LAN address', () => {
    process.env.NODE_ENV = 'development';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    assertWebOriginIsRestricted('*');
    assertWebOriginIsRestricted('http://localhost:5173,http://192.168.1.50:5173');
    assertWebOriginIsRestricted('http://192.168.1.50:5173');

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not exit when NODE_ENV=test, even for a LAN address', () => {
    process.env.NODE_ENV = 'test';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    assertWebOriginIsRestricted('http://localhost:4173');

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('allows a single real public origin when NODE_ENV is unset', () => {
    delete process.env.NODE_ENV;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    assertWebOriginIsRestricted('https://app.bandstand.example');

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits when NODE_ENV is unset and WEB_ORIGIN contains a wildcard', () => {
    delete process.env.NODE_ENV;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assertWebOriginIsRestricted('*');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when NODE_ENV is unset and WEB_ORIGIN carries more than one origin', () => {
    delete process.env.NODE_ENV;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assertWebOriginIsRestricted('https://app.bandstand.example,https://staging.bandstand.example');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it.each([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://192.168.1.50:5173',
    'http://10.0.0.5:5173',
    'http://172.16.4.2:5173',
    'http://169.254.1.1:5173',
    'http://my-laptop.local:5173',
    'http://[::1]:5173',
  ])('exits when NODE_ENV is unset and WEB_ORIGIN is the private/local address %s', (origin) => {
    delete process.env.NODE_ENV;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assertWebOriginIsRestricted(origin);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('still exits in production for a private/local address (the old, still-supported case)', () => {
    process.env.NODE_ENV = 'production';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assertWebOriginIsRestricted('http://localhost:5173');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
