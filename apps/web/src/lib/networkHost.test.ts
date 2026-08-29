// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withRuntimeHost } from './networkHost';

describe('withRuntimeHost', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the URL unchanged when there is no window (e.g. SSR/test)', () => {
    expect(withRuntimeHost('http://localhost:3001')).toBe('http://localhost:3001');
  });

  it("swaps a loopback hostname for the page's own host", () => {
    vi.stubGlobal('window', { location: { hostname: '192.168.1.50' } });

    expect(withRuntimeHost('http://localhost:3001')).toBe('http://192.168.1.50:3001');
    expect(withRuntimeHost('ws://127.0.0.1:3002')).toBe('ws://192.168.1.50:3002');
    expect(withRuntimeHost('http://[::1]:3001')).toBe('http://192.168.1.50:3001');
  });

  it('leaves an explicitly configured non-loopback host untouched', () => {
    vi.stubGlobal('window', { location: { hostname: '192.168.1.50' } });

    expect(withRuntimeHost('https://api.bandstand.example')).toBe('https://api.bandstand.example');
  });

  it('returns the input unchanged for an unparseable URL', () => {
    vi.stubGlobal('window', { location: { hostname: '192.168.1.50' } });

    expect(withRuntimeHost('not-a-url')).toBe('not-a-url');
  });
});
