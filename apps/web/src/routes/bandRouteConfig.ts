// SPDX-License-Identifier: Apache-2.0
//
// The pure shape of every band-scoped route — no component imports here on
// purpose. router.tsx pairs each entry with its page component to actually
// render routes; AppHeader's band-switch navigation only needs the shapes,
// and importing router.tsx's component-bearing version from there would
// cycle back through Dashboard -> AppHeader -> here.
import { matchPath } from 'react-router';

interface StableBandRoute {
  /** Path segment(s) after `/bands/:bandId/`, e.g. `repertoire` or `songs/new`. */
  path: string;
  /** No id of its own beyond :bandId — safe to keep showing across a band switch. */
  kind: 'stable';
}

interface VolatileBandRoute {
  path: string;
  /** Has its own id (a song, a setlist, an event, a poll) that won't exist in another band. */
  kind: 'volatile';
  /** Where a band switch lands instead — must equal another entry's `path`. */
  fallback: string;
}

export type BandRouteShape = StableBandRoute | VolatileBandRoute;

/**
 * Every band-scoped route, in one place — router.tsx renders <Route>s
 * straight from this (paired with each page's component), so there is no
 * second place a new band-scoped page could be added without also being
 * classified here. See bandRouteConfig.test.ts for the completeness check.
 */
export const bandRouteShapes: BandRouteShape[] = [
  { path: 'dashboard', kind: 'stable' },
  { path: 'settings', kind: 'stable' },
  { path: 'repertoire', kind: 'stable' },
  { path: 'songs/new', kind: 'stable' },
  { path: 'songs/:songId/edit', kind: 'volatile', fallback: 'repertoire' },
  // Reachable only via a direct link, never the band switcher (Stage Mode
  // has no header at all — see StageMode.tsx) — included anyway so
  // resolveBandSwitchPath stays a total function over every band-scoped
  // route, not just the ones reachable from the switcher today.
  { path: 'songs/:songId/play', kind: 'volatile', fallback: 'repertoire' },
  { path: 'setlists', kind: 'stable' },
  { path: 'setlists/:setlistId', kind: 'volatile', fallback: 'setlists' },
  { path: 'setlists/:setlistId/stage/:itemId', kind: 'volatile', fallback: 'setlists' },
  { path: 'calendar', kind: 'stable' },
  { path: 'calendar/:occurrenceId', kind: 'volatile', fallback: 'calendar' },
  { path: 'polls/:pollId', kind: 'volatile', fallback: 'calendar' },
];

/**
 * Where a band switch should navigate, given the page currently open and
 * the newly selected band. `stable` routes carry their exact suffix over
 * (e.g. .../repertoire -> .../repertoire, with no other id involved);
 * `volatile` ones (a specific song/setlist/event/poll) land on their
 * section's overview instead, since that id is very unlikely to exist in
 * the other band. Falls back to that band's dashboard if the current path
 * isn't a band-scoped route at all (e.g. still on the bare /dashboard).
 */
export function resolveBandSwitchPath(pathname: string, newBandId: string): string {
  for (const route of bandRouteShapes) {
    if (matchPath(`/bands/:bandId/${route.path}`, pathname)) {
      const target = route.kind === 'stable' ? route.path : route.fallback;
      return `/bands/${newBandId}/${target}`;
    }
  }
  return `/bands/${newBandId}/dashboard`;
}
