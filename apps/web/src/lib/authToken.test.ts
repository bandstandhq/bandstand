// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearToken, getStoredToken, persistToken } from './authToken';

function fakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
}

describe('authToken', () => {
  beforeEach(() => {
    // @ts-expect-error -- test-only global stub, same pattern as serverConfig.test.ts
    globalThis.localStorage = fakeLocalStorage();
  });

  afterEach(() => {
    // @ts-expect-error -- see beforeEach
    delete globalThis.localStorage;
  });

  it('returns undefined when nothing is stored', () => {
    expect(getStoredToken()).toBeUndefined();
  });

  it('round-trips a persisted token', () => {
    persistToken('abc123');
    expect(getStoredToken()).toBe('abc123');
  });

  it('clears a stored token', () => {
    persistToken('abc123');
    clearToken();
    expect(getStoredToken()).toBeUndefined();
  });

  it('swallows a localStorage.getItem failure', () => {
    // @ts-expect-error -- test-only global stub
    globalThis.localStorage = {
      getItem: () => {
        throw new Error('storage unavailable');
      },
    };
    expect(getStoredToken()).toBeUndefined();
  });

  it('swallows a localStorage.setItem failure', () => {
    // @ts-expect-error -- test-only global stub
    globalThis.localStorage = {
      setItem: () => {
        throw new Error('storage full');
      },
    };
    expect(() => persistToken('abc123')).not.toThrow();
  });
});
