// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertNotDevPlaceholder } from './envGuard';

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
