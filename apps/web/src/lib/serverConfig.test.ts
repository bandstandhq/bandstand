// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearServerOverride,
  DEFAULT_SERVER_CONFIG,
  getActiveServerConfig,
  isUsingCustomServer,
  setServerOverride,
} from './serverConfig';

function fakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
}

const CUSTOM = { serverUrl: 'https://bandstand.example.com', hocuspocusUrl: 'wss://bandstand.example.com' };

describe('serverConfig', () => {
  let originalDev: boolean;

  beforeEach(() => {
    // @ts-expect-error -- test-only global stub, same pattern as networkHost.test.ts
    globalThis.localStorage = fakeLocalStorage();
    // @ts-expect-error -- no real IndexedDB in this (Node, non-jsdom) test environment
    globalThis.indexedDB = undefined;
    originalDev = import.meta.env.DEV;
  });

  afterEach(() => {
    // @ts-expect-error -- see beforeEach
    delete globalThis.localStorage;
    import.meta.env.DEV = originalDev;
  });

  it('is always the build-time default in dev, regardless of any stored override', () => {
    import.meta.env.DEV = true;
    setServerOverride(CUSTOM);

    expect(getActiveServerConfig()).toEqual(DEFAULT_SERVER_CONFIG);
    expect(isUsingCustomServer()).toBe(false);
  });

  it('outside dev, falls back to the default when nothing is stored', () => {
    import.meta.env.DEV = false;

    expect(getActiveServerConfig()).toEqual(DEFAULT_SERVER_CONFIG);
    expect(isUsingCustomServer()).toBe(false);
  });

  it('outside dev, returns a stored override once set', () => {
    import.meta.env.DEV = false;
    setServerOverride(CUSTOM);

    expect(getActiveServerConfig()).toEqual(CUSTOM);
    expect(isUsingCustomServer()).toBe(true);
  });

  it('clearing the override reverts to the default', () => {
    import.meta.env.DEV = false;
    setServerOverride(CUSTOM);
    clearServerOverride();

    expect(getActiveServerConfig()).toEqual(DEFAULT_SERVER_CONFIG);
    expect(isUsingCustomServer()).toBe(false);
  });

  it('setting or clearing an override wipes the persisted active-band selection', () => {
    localStorage.setItem('bandstand-active-band', '{"state":{"activeBandId":"some-band"}}');
    setServerOverride(CUSTOM);
    expect(localStorage.getItem('bandstand-active-band')).toBeNull();

    localStorage.setItem('bandstand-active-band', '{"state":{"activeBandId":"some-band"}}');
    clearServerOverride();
    expect(localStorage.getItem('bandstand-active-band')).toBeNull();
  });

  it('treats malformed stored JSON as no override', () => {
    import.meta.env.DEV = false;
    localStorage.setItem('bandstand.serverConfig', 'not-json');

    expect(getActiveServerConfig()).toEqual(DEFAULT_SERVER_CONFIG);
  });

  it('treats a stored value missing either field as no override', () => {
    import.meta.env.DEV = false;
    localStorage.setItem('bandstand.serverConfig', JSON.stringify({ serverUrl: 'https://example.test' }));

    expect(getActiveServerConfig()).toEqual(DEFAULT_SERVER_CONFIG);
  });
});
