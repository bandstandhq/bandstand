// SPDX-License-Identifier: Apache-2.0
//
// Keeps every distinct band page the user has visited this session mounted
// but hidden (via React's <Activity>) instead of fully unmounted on
// navigation, so returning to one is instant — no remount, no re-fetch, no
// loading flash (issue #232). Renders in place of a plain <Outlet/> inside
// AuthenticatedLayout.
//
// Each resident "slot" is keyed by pathname, not by route id + params
// separately — a pathname like /bands/b1/songs/s1/edit already uniquely
// identifies "band b1's editor for song s1", so switching bands or opening a
// different song naturally produces a different slot instead of reusing a
// stale one. This also makes the old KeyedByBandId remount-on-band-switch
// trick unnecessary for anything routed through here: two different bands'
// Repertoire pages are already two different slots, each with its own
// correctly-scoped local state, not two renders of one shared instance.
//
// useOutlet() (not a route lookup of our own) is what makes this safe: it
// returns exactly the element React Router would have rendered via a normal
// <Outlet/>, so prefetching, code-splitting, and route matching all keep
// working unmodified — this component only decides which already-resolved
// outlet elements stay in the tree, never how to resolve one.
//
// The registry updates via React's documented "adjusting state during
// rendering" pattern (conditional setState in the render body, guarded by a
// tracked previous value) rather than setState-in-an-effect: an effect would
// render once with the stale registry and again after committing the
// update, while this settles in one pass. Refs were the first thing tried
// here, but this project's lint config forbids reading ref.current during
// render (react-hooks/refs) for React Compiler compatibility.
//
// One real gotcha, confirmed by hand (React 19.2.8 + react-router 8.3.1): a
// hidden slot's useParams() stays correctly frozen at whatever it was when
// last visible, but useLocation() does NOT — it re-reads the live location
// even while hidden, since LocationContext updates propagate through
// <Activity mode="hidden"> even though the route-match context backing
// useParams() doesn't. None of the pages rendered through here call
// useLocation()/useSearchParams() today (only pre-auth pages and the chrome
// components rendered outside this tree do) — if that ever changes, that
// page cannot safely rely on useLocation() while resident here.
//
// A hidden slot's content is genuinely display:none (verified — Activity applies it
// per DOM node, real screen readers correctly skip it) but still MATCHES accessible-name
// locators (getByLabel/getByRole) regardless of visibility — only .isVisible()/:visible
// filters it out. Any Playwright test whose accessible name could also exist on another
// resident page (e.g. "Band name" on every band's settings) needs `.and(page.locator(':visible'))`
// or equivalent — see band-switch.spec.ts and song-numeric-fields.spec.ts for the pattern.
import { Activity, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useOutlet } from 'react-router';

// Bare /dashboard (DashboardRedirect) re-resolves which band to send you to
// on every visit and explicitly assumes a fresh mount each time — never give
// it a resident slot.
const NEVER_PERSIST_PATHNAMES = new Set(['/dashboard']);

// Only volatile detail pages (song/setlist/event/poll) can accumulate
// unboundedly within one session (open enough different songs and each gets
// its own slot) — stable pages are naturally bounded by how many bands +
// sections exist, so a generous total cap only ever bites the volatile case.
const MAX_RESIDENT_SLOTS = 15;

interface Slot {
  pathname: string;
  outlet: ReactNode;
  lastVisited: number;
}

function withVisit(slots: Map<string, Slot>, pathname: string, outlet: ReactNode): Map<string, Slot> {
  const next = new Map(slots);
  next.set(pathname, { pathname, outlet, lastVisited: Date.now() });
  if (next.size > MAX_RESIDENT_SLOTS) {
    const lruKey = [...next.values()].sort((a, b) => a.lastVisited - b.lastVisited)[0]?.pathname;
    if (lruKey && lruKey !== pathname) next.delete(lruKey);
  }
  return next;
}

export function PersistentRouteHost() {
  const { pathname } = useLocation();
  const outlet = useOutlet();
  const skipPersistence = NEVER_PERSIST_PATHNAMES.has(pathname);

  const [slots, setSlots] = useState<Map<string, Slot>>(() =>
    skipPersistence ? new Map() : withVisit(new Map(), pathname, outlet),
  );
  const [recordedFor, setRecordedFor] = useState(pathname);
  if (pathname !== recordedFor) {
    setRecordedFor(pathname);
    if (!skipPersistence) setSlots((prev) => withVisit(prev, pathname, outlet));
  }

  if (skipPersistence) return outlet;

  // Every slot — including the current one — renders from this one `.map()`, never as a
  // separate trailing element: keyed reconciliation only matches elements within the same
  // structural position across renders, so the current page moving between "the mapped
  // list" and "a standalone element" as it changes would read as a different element
  // despite the identical key, silently resetting it every time it stopped being current
  // (confirmed by hand — this is exactly the state-loss bug that shape had).
  return (
    <>
      {[...slots.values()].map((slot) => (
        <Activity key={slot.pathname} mode={slot.pathname === pathname ? 'visible' : 'hidden'}>
          {slot.pathname === pathname ? outlet : slot.outlet}
        </Activity>
      ))}
    </>
  );
}
