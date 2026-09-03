// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearCachedSession, getCachedSession, setCachedSession } from './sessionCache';

function fakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
}

describe('sessionCache', () => {
  beforeEach(() => {
    // @ts-expect-error -- test-only global stub, same pattern as authToken.test.ts
    globalThis.localStorage = fakeLocalStorage();
  });

  afterEach(() => {
    // @ts-expect-error -- see beforeEach
    delete globalThis.localStorage;
  });

  it('returns null when nothing is cached', () => {
    expect(getCachedSession()).toBeNull();
  });

  it('round-trips a cached session object', () => {
    const session = { user: { id: 'u1' }, session: { token: 'tok' } };
    setCachedSession(session);
    expect(getCachedSession()).toEqual(session);
  });

  it('clears a cached session', () => {
    setCachedSession({ user: { id: 'u1' } });
    clearCachedSession();
    expect(getCachedSession()).toBeNull();
  });

  it('swallows a localStorage failure on read and write', () => {
    // @ts-expect-error -- test-only global stub
    globalThis.localStorage = {
      getItem: () => {
        throw new Error('storage unavailable');
      },
      setItem: () => {
        throw new Error('storage unavailable');
      },
    };
    expect(getCachedSession()).toBeNull();
    expect(() => setCachedSession({ user: { id: 'u1' } })).not.toThrow();
  });
});
