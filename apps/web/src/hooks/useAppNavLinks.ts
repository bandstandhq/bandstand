// SPDX-License-Identifier: Apache-2.0
//
// Shared between AppTopbar (desktop) and BottomNav (narrow screens) —
// factors out the parts of the old AppHeader that had nothing to do with
// which layout renders them: which band the nav links should point at, and
// what actually happens on a band switch / sign-out. Anything narrow-
// screen-specific (the Sheet's own open state, the popstate/back-button
// handling) stays local to BottomNav instead of living here.
import { useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { signOut } from '../lib/auth-client';
import { resolveBandSwitchPath } from '../routes/bandRouteConfig';
import { useActiveBandStore } from '../stores/activeBand';
import { useUserPrefsStore } from '../stores/userPrefs';

export function useAppNavLinks() {
  const location = useLocation();
  const navigate = useNavigate();
  // The URL is the source of truth for "which band" on every page this nav
  // appears on (all of them are either a /bands/:bandId/... route or the
  // bare /dashboard, where there's no current band at all) — never the
  // store. See the effect below for what the store is still for.
  const { bandId: currentBandId } = useParams<{ bandId?: string }>();
  const activeBandId = useActiveBandStore((s) => s.activeBandId);
  const setActiveBandId = useActiveBandStore((s) => s.setActiveBandId);
  const resetUserPrefs = useUserPrefsStore((s) => s.reset);

  // The store's activeBandId has exactly one remaining job: remembering
  // which band the bare /dashboard route should redirect to next time
  // (DashboardRedirect.tsx). Keeping it in sync with wherever the user
  // actually, currently is — rather than only ever writing it from the
  // band switcher — means that redirect target is never more stale than
  // "the last band-scoped page you were on."
  useEffect(() => {
    if (currentBandId) setActiveBandId(currentBandId);
  }, [currentBandId, setActiveBandId]);

  // The URL's own :bandId wins when present; otherwise the last band the
  // user was actually on (falls back further to nothing at all for a user
  // who has never had one). This is what keeps the nav identical on a
  // band-independent page like /settings instead of losing every band link
  // just because this particular page has no :bandId of its own.
  const effectiveBandId = currentBandId ?? activeBandId ?? null;

  // No band at all (not even a remembered one) — every band-scoped link
  // still points at /dashboard, which is exactly where a bandless user can
  // join or create one; it must never just disappear.
  function bandPath(suffix: string): string {
    return effectiveBandId ? `/bands/${effectiveBandId}/${suffix}` : '/dashboard';
  }

  function navigateToBand(newBandId: string) {
    navigate(resolveBandSwitchPath(location.pathname, newBandId));
  }

  function signOutAndReset() {
    // The only band-related client state that outlives a page unmount
    // (everything else is component-local, reset for free when RequireAuth
    // redirects to /login) — must not leak into whoever signs in next on
    // this device. IndexedDB caches deliberately stay (ADR-0006), but
    // nothing derived from them may still be *displayed* after this.
    setActiveBandId(null);
    resetUserPrefs();
    void signOut();
  }

  return { effectiveBandId, bandPath, navigateToBand, signOutAndReset };
}
