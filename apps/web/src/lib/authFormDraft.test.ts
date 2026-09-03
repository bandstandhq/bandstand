// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearDraftEmail, getDraftEmail, setDraftEmail } from './authFormDraft';

function fakeSessionStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
}

describe('authFormDraft', () => {
  beforeEach(() => {
    // @ts-expect-error -- test-only global stub, same pattern as authToken.test.ts
    globalThis.sessionStorage = fakeSessionStorage();
  });

  afterEach(() => {
    // @ts-expect-error -- see beforeEach
    delete globalThis.sessionStorage;
  });

  it('returns an empty string when nothing is stored', () => {
    expect(getDraftEmail()).toBe('');
  });

  it('round-trips a stored email', () => {
    setDraftEmail('alice@bandstand.local');
    expect(getDraftEmail()).toBe('alice@bandstand.local');
  });

  it('setting an empty string clears any previously stored value', () => {
    setDraftEmail('alice@bandstand.local');
    setDraftEmail('');
    expect(getDraftEmail()).toBe('');
  });

  it('clears a stored email', () => {
    setDraftEmail('alice@bandstand.local');
    clearDraftEmail();
    expect(getDraftEmail()).toBe('');
  });

  it('swallows a sessionStorage failure', () => {
    // @ts-expect-error -- test-only global stub
    globalThis.sessionStorage = {
      getItem: () => {
        throw new Error('storage unavailable');
      },
      setItem: () => {
        throw new Error('storage unavailable');
      },
    };
    expect(getDraftEmail()).toBe('');
    expect(() => setDraftEmail('alice@bandstand.local')).not.toThrow();
  });
});
