// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@hocuspocus/provider', () => {
  class HocuspocusProvider {
    configuration: unknown;
    destroyed = false;
    isSynced = false;
    constructor(configuration: unknown) {
      this.configuration = configuration;
    }
    on() {}
    off() {}
    destroy() {
      this.destroyed = true;
    }
  }
  return { HocuspocusProvider };
});

vi.mock('y-indexeddb', () => {
  class IndexeddbPersistence {
    name: string;
    destroyed = false;
    constructor(name: string) {
      this.name = name;
    }
    destroy() {
      this.destroyed = true;
    }
    clearData() {
      return Promise.resolve();
    }
  }
  return { IndexeddbPersistence, clearDocument: vi.fn() };
});

vi.mock('./serverConfig', () => ({
  getActiveServerConfig: () => ({ hocuspocusUrl: 'ws://test.invalid' }),
}));

const { acquireBandDoc, evictBandDoc, releaseBandDoc } = await import('./yjs');

describe('band doc connection registry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reuses the same connection for concurrent acquires of the same user+band+token', () => {
    const a = acquireBandDoc('user-1', 'band-1', 'token-1');
    const b = acquireBandDoc('user-1', 'band-1', 'token-1');
    expect(b).toBe(a);
    releaseBandDoc('user-1', 'band-1');
    releaseBandDoc('user-1', 'band-1');
  });

  it('keeps a connection resident (not destroyed) if reacquired before the idle grace period elapses', () => {
    const first = acquireBandDoc('user-1', 'band-2', 'token-1');
    releaseBandDoc('user-1', 'band-2');

    vi.advanceTimersByTime(5_000);
    const second = acquireBandDoc('user-1', 'band-2', 'token-1');

    expect(second).toBe(first);
    expect((first.provider as unknown as { destroyed: boolean }).destroyed).toBe(false);

    releaseBandDoc('user-1', 'band-2');
  });

  it('destroys a connection once the idle grace period fully elapses with no reacquire', () => {
    const connection = acquireBandDoc('user-1', 'band-3', 'token-1');
    releaseBandDoc('user-1', 'band-3');

    vi.advanceTimersByTime(30_000);

    expect((connection.provider as unknown as { destroyed: boolean }).destroyed).toBe(true);
    expect((connection.indexeddb as unknown as { destroyed: boolean }).destroyed).toBe(true);

    const fresh = acquireBandDoc('user-1', 'band-3', 'token-1');
    expect(fresh).not.toBe(connection);
    releaseBandDoc('user-1', 'band-3');
  });

  it('replaces a stale-token connection outright instead of reusing it', () => {
    const stale = acquireBandDoc('user-1', 'band-4', 'token-old');
    const fresh = acquireBandDoc('user-1', 'band-4', 'token-new');

    expect(fresh).not.toBe(stale);
    expect((stale.provider as unknown as { destroyed: boolean }).destroyed).toBe(true);

    releaseBandDoc('user-1', 'band-4');
  });

  it('evicts a connection immediately regardless of outstanding references', () => {
    const connection = acquireBandDoc('user-1', 'band-5', 'token-1');
    acquireBandDoc('user-1', 'band-5', 'token-1');

    evictBandDoc('user-1', 'band-5');

    expect((connection.provider as unknown as { destroyed: boolean }).destroyed).toBe(true);

    const fresh = acquireBandDoc('user-1', 'band-5', 'token-1');
    expect(fresh).not.toBe(connection);
    releaseBandDoc('user-1', 'band-5');
  });
});
