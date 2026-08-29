// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { bandRouteShapes, resolveBandSwitchPath } from './bandRouteConfig';

describe('bandRouteShapes', () => {
  it('every volatile route points its fallback at a real stable route', () => {
    const stablePaths = new Set(bandRouteShapes.filter((r) => r.kind === 'stable').map((r) => r.path));
    for (const route of bandRouteShapes) {
      if (route.kind === 'volatile') {
        expect(stablePaths.has(route.fallback), `"${route.path}"'s fallback "${route.fallback}" is not a stable route`).toBe(
          true,
        );
      }
    }
  });

  it('has no duplicate path entries', () => {
    const paths = bandRouteShapes.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('resolveBandSwitchPath', () => {
  const NEW_BAND = 'band-b';

  it('carries a stable route over to the new band unchanged', () => {
    expect(resolveBandSwitchPath('/bands/band-a/repertoire', NEW_BAND)).toBe('/bands/band-b/repertoire');
    expect(resolveBandSwitchPath('/bands/band-a/settings', NEW_BAND)).toBe('/bands/band-b/settings');
    expect(resolveBandSwitchPath('/bands/band-a/setlists', NEW_BAND)).toBe('/bands/band-b/setlists');
    expect(resolveBandSwitchPath('/bands/band-a/calendar', NEW_BAND)).toBe('/bands/band-b/calendar');
    expect(resolveBandSwitchPath('/bands/band-a/dashboard', NEW_BAND)).toBe('/bands/band-b/dashboard');
    expect(resolveBandSwitchPath('/bands/band-a/songs/new', NEW_BAND)).toBe('/bands/band-b/songs/new');
  });

  it('sends a volatile route (an id specific to the old band) to its section overview instead', () => {
    expect(resolveBandSwitchPath('/bands/band-a/songs/song-1/edit', NEW_BAND)).toBe('/bands/band-b/repertoire');
    expect(resolveBandSwitchPath('/bands/band-a/songs/song-1/play', NEW_BAND)).toBe('/bands/band-b/repertoire');
    expect(resolveBandSwitchPath('/bands/band-a/setlists/setlist-1', NEW_BAND)).toBe('/bands/band-b/setlists');
    expect(resolveBandSwitchPath('/bands/band-a/setlists/setlist-1/stage/item-1', NEW_BAND)).toBe(
      '/bands/band-b/setlists',
    );
    expect(resolveBandSwitchPath('/bands/band-a/calendar/occurrence-1', NEW_BAND)).toBe('/bands/band-b/calendar');
    expect(resolveBandSwitchPath('/bands/band-a/polls/poll-1', NEW_BAND)).toBe('/bands/band-b/calendar');
  });

  it('falls back to the new band\'s dashboard when the current path is not a band-scoped route at all', () => {
    expect(resolveBandSwitchPath('/dashboard', NEW_BAND)).toBe('/bands/band-b/dashboard');
    expect(resolveBandSwitchPath('/join/ABC123', NEW_BAND)).toBe('/bands/band-b/dashboard');
  });
});
