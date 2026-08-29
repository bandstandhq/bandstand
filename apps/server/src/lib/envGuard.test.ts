// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertNotDevPlaceholder, assertProductionOriginIsRestricted } from './envGuard';

describe('assertNotDevPlaceholder', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it('exits when NODE_ENV is production and the value still matches the placeholder', () => {
    process.env.NODE_ENV = 'production';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assertNotDevPlaceholder('MINIO_ACCESS_KEY', 'dev-only-changeme', 'dev-only-changeme');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not exit in production when the value was actually changed', () => {
    process.env.NODE_ENV = 'production';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    assertNotDevPlaceholder('MINIO_ACCESS_KEY', 'a-real-secret', 'dev-only-changeme');

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not exit outside production even if the placeholder is still set', () => {
    process.env.NODE_ENV = 'development';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    assertNotDevPlaceholder('MINIO_ACCESS_KEY', 'dev-only-changeme', 'dev-only-changeme');

    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe('assertProductionOriginIsRestricted', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it('does not exit outside production, even for a wildcard, a list, or a LAN address', () => {
    process.env.NODE_ENV = 'development';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    assertProductionOriginIsRestricted('*');
    assertProductionOriginIsRestricted('http://localhost:5173,http://192.168.1.50:5173');
    assertProductionOriginIsRestricted('http://192.168.1.50:5173');

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('allows a single real public origin in production', () => {
    process.env.NODE_ENV = 'production';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    assertProductionOriginIsRestricted('https://app.bandstand.example');

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits in production when WEB_ORIGIN contains a wildcard', () => {
    process.env.NODE_ENV = 'production';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assertProductionOriginIsRestricted('*');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits in production when WEB_ORIGIN carries more than one origin', () => {
    process.env.NODE_ENV = 'production';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assertProductionOriginIsRestricted('https://app.bandstand.example,https://staging.bandstand.example');

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
  ])('exits in production when WEB_ORIGIN is the private/local address %s', (origin) => {
    process.env.NODE_ENV = 'production';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assertProductionOriginIsRestricted(origin);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
