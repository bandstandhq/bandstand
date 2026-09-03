// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAuthFetchSuccess, resolveAuthToken } from './auth-client';

function fakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
}

describe('auth-client', () => {
  beforeEach(() => {
    // @ts-expect-error -- test-only global stub, same pattern as serverConfig.test.ts
    globalThis.localStorage = fakeLocalStorage();
  });

  afterEach(() => {
    // @ts-expect-error -- see beforeEach
    delete globalThis.localStorage;
    vi.unstubAllGlobals();
  });

  describe('handleAuthFetchSuccess', () => {
    it.each(['Capacitor', '__TAURI_INTERNALS__', '__TAURI__'])(
      'persists the set-auth-token header when wrapped (%s)',
      (globalName) => {
        vi.stubGlobal('window', { [globalName]: {} });

        handleAuthFetchSuccess({ response: new Response(null, { headers: { 'set-auth-token': 'tok-123' } }) });

        expect(localStorage.getItem('bandstand.authToken')).toBe('tok-123');
      },
    );

    it('does nothing when wrapped but the response carries no token', () => {
      vi.stubGlobal('window', { Capacitor: {} });

      handleAuthFetchSuccess({ response: new Response(null) });

      expect(localStorage.getItem('bandstand.authToken')).toBeNull();
    });

    it('does not persist a token when not wrapped, even if the header is present', () => {
      vi.stubGlobal('window', {});

      handleAuthFetchSuccess({ response: new Response(null, { headers: { 'set-auth-token': 'tok-123' } }) });

      expect(localStorage.getItem('bandstand.authToken')).toBeNull();
    });
  });

  describe('resolveAuthToken', () => {
    it('returns the stored token when wrapped', () => {
      vi.stubGlobal('window', { Capacitor: {} });
      localStorage.setItem('bandstand.authToken', 'tok-123');

      expect(resolveAuthToken()).toBe('tok-123');
    });

    it('returns undefined when wrapped but nothing is stored', () => {
      vi.stubGlobal('window', { Capacitor: {} });

      expect(resolveAuthToken()).toBeUndefined();
    });

    it('returns undefined when not wrapped, even if a token happens to be stored', () => {
      vi.stubGlobal('window', {});
      localStorage.setItem('bandstand.authToken', 'tok-123');

      expect(resolveAuthToken()).toBeUndefined();
    });
  });
});
