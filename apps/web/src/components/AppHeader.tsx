// SPDX-License-Identifier: Apache-2.0
//
// The shared header + navigation menu for every signed-in page except
// Stage Mode (which deliberately has no header at all — see StageMode.tsx).
// Two entirely separate layouts, chosen via useMediaQuery rather than a
// CSS hidden/sm:flex pair: BandSwitcher does its own data fetching, so
// rendering both variants at once (one merely CSS-hidden) would mount it
// twice — see useMediaQuery's own docstring for why that's the wrong tool
// here. Everything reachable inline on a wide screen is also reachable in
// the narrow-screen menu (and vice versa) — neither layout has anything
// exclusive to it.
import { Button, Sheet } from '@bandstand/ui';
import { ChevronRight, Menu } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { BandSwitcher } from './BandSwitcher';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { signOut } from '../lib/auth-client';
import { resolveBandSwitchPath } from '../routes/bandRouteConfig';
import { useActiveBandStore } from '../stores/activeBand';
import { useUserPrefsStore } from '../stores/userPrefs';

/**
 * A link to another page — plain text, deliberately never a `<Button>`, so
 * it can't be confused with something that performs an action in place.
 * `inline` is the understated wide-screen style; `list` is the menu's
 * full-width row-with-chevron style.
 */
function NavLink({
  to,
  variant,
  onNavigate,
  children,
}: {
  to: string;
  variant: 'inline' | 'list';
  onNavigate?: () => void;
  children: ReactNode;
}) {
  if (variant === 'inline') {
    return (
      <Link
        to={to}
        onClick={onNavigate}
        className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {children}
      </Link>
    );
  }
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className="flex items-center justify-between gap-2 rounded-lg px-3 py-3 text-base font-medium text-foreground/90 transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</p>;
}

export function AppHeader({ title }: { title: ReactNode }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  // The URL is the source of truth for "which band" on every page this
  // header appears on (all of them are either a /bands/:bandId/... route or
  // the bare /dashboard, where there's no current band at all) — never the
  // store. See the effect below for what the store is still for.
  const { bandId: currentBandId } = useParams<{ bandId?: string }>();
  const activeBandId = useActiveBandStore((s) => s.activeBandId);
  const setActiveBandId = useActiveBandStore((s) => s.setActiveBandId);
  const resetUserPrefs = useUserPrefsStore((s) => s.reset);
  const isWide = useMediaQuery('(min-width: 640px)');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // The store's activeBandId has exactly one remaining job: remembering
  // which band the bare /dashboard route should redirect to next time
  // (DashboardRedirect.tsx). Keeping it in sync with wherever the user
  // actually, currently is — rather than only ever writing it from the
  // band switcher — means that redirect target is never more stale than
  // "the last band-scoped page you were on."
  useEffect(() => {
    if (currentBandId) setActiveBandId(currentBandId);
  }, [currentBandId, setActiveBandId]);

  function handleBandChange(newBandId: string) {
    setMenuOpen(false);
    navigate(resolveBandSwitchPath(location.pathname, newBandId));
  }

  // Makes the phone/browser back button close the menu instead of leaving
  // the page — Radix's Escape/outside-click/X handling doesn't touch
  // browser history on its own. A NavLink click bypasses this deliberately
  // (see its own onNavigate): it unmounts this page by navigating to a
  // different route, so there's nothing here to reconcile with — the small
  // trade-off is a leftover history entry in that case, same as most
  // mobile nav drawers.
  const pushedHistoryRef = useRef(false);

  useEffect(() => {
    if (!menuOpen) return;
    window.history.pushState({ appHeaderMenuOpen: true }, '');
    pushedHistoryRef.current = true;

    function handlePopState() {
      pushedHistoryRef.current = false;
      setMenuOpen(false);
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [menuOpen]);

  // Belt-and-braces on top of Radix's own onCloseAutoFocus: some mobile
  // browsers (notably iOS Safari) don't focus a <button> on tap, so Radix's
  // "return focus to whatever had it before" can have nothing to return
  // to. Explicitly re-focusing the trigger here runs after Radix's own
  // close-focus handling (this effect lives in the parent, which commits
  // after the child Sheet's), so it always wins.
  const wasMenuOpenRef = useRef(false);
  useEffect(() => {
    if (wasMenuOpenRef.current && !menuOpen) {
      menuButtonRef.current?.focus();
    }
    wasMenuOpenRef.current = menuOpen;
  }, [menuOpen]);

  function handleMenuOpenChange(open: boolean) {
    if (open) {
      setMenuOpen(true);
      return;
    }
    // Radix wants to close (Escape, tapping the dimmed area, or the X)
    // while staying on this page — consume the history entry pushed above
    // via a real back navigation, so the hardware back button and the X
    // behave identically instead of stacking up dead entries.
    if (pushedHistoryRef.current) {
      pushedHistoryRef.current = false;
      window.history.back();
    } else {
      setMenuOpen(false);
    }
  }

  function handleSignOut() {
    setMenuOpen(false);
    // The only band-related client state that outlives a page unmount
    // (everything else is component-local, reset for free when RequireAuth
    // redirects to /login) — must not leak into whoever signs in next on
    // this device. IndexedDB caches deliberately stay (ADR-0006), but
    // nothing derived from them may still be *displayed* after this.
    setActiveBandId(null);
    resetUserPrefs();
    void signOut();
  }

  // Actions (do something in place) are always `<Button>`s, styled to
  // signal what kind of action: destructive gets the destructive variant,
  // everything else outline — never ghost, which is reserved for nav
  // links so the two categories read differently at a glance. Sign out is
  // the only one left here — Account settings is a real page (a NavLink),
  // and Delete local data/theme moved into that page itself (see
  // AccountSettings.tsx). Used for the wide-screen inline layout only —
  // the Sheet (narrow-screen menu) below renders its own, bigger sign-out
  // button directly, alongside Account settings under the same "Account"
  // section, since that pairing doesn't exist in the inline layout.
  const actionButtons = (
    <Button variant="outline" size="sm" onClick={handleSignOut}>
      {t('appHeader.logout')}
    </Button>
  );

  // The URL's own :bandId wins when present; otherwise the last band the
  // user was actually on (falls back further to nothing at all for a user
  // who has never had one). This is what keeps the menu identical on a
  // band-independent page like /settings instead of losing every band link
  // just because this particular page has no :bandId of its own.
  const effectiveBandId = currentBandId ?? activeBandId ?? null;

  function navLinks(variant: 'inline' | 'list', onNavigate?: () => void) {
    // No band at all (not even a remembered one) — every band-scoped link
    // still shows, but points at /dashboard, which is exactly where a
    // bandless user can join or create one; it must never just disappear,
    // which is what let this whole menu look different depending on page.
    const bandPath = (suffix: string) => (effectiveBandId ? `/bands/${effectiveBandId}/${suffix}` : '/dashboard');
    return (
      <nav
        className={variant === 'inline' ? 'flex flex-wrap items-center gap-4' : 'flex flex-col divide-y divide-border'}
        aria-label={t('appHeader.navLabel')}
      >
        <NavLink to={bandPath('repertoire')} variant={variant} onNavigate={onNavigate}>
          {t('appHeader.repertoire')}
        </NavLink>
        <NavLink to={bandPath('setlists')} variant={variant} onNavigate={onNavigate}>
          {t('appHeader.setlists')}
        </NavLink>
        <NavLink to={bandPath('calendar')} variant={variant} onNavigate={onNavigate}>
          {t('appHeader.calendar')}
        </NavLink>
        <NavLink to={bandPath('settings')} variant={variant} onNavigate={onNavigate}>
          {t('appHeader.bandSettings')}
        </NavLink>
        {/* Band-independent — always the real page, never routed through
            /dashboard the way the band-scoped links above are. Inline
            (wide-screen) layout only: the menu (Sheet) puts this under its
            own "Account" section instead, alongside sign-out, rather than
            mixed in with this band-scoped list — see the Sheet's JSX below. */}
        {variant === 'inline' && (
          <NavLink to="/settings" variant={variant} onNavigate={onNavigate}>
            {t('appHeader.accountSettings')}
          </NavLink>
        )}
      </nav>
    );
  }

  if (isWide) {
    return (
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-xl font-medium">{title}</h1>
        <div className="ml-auto flex flex-wrap items-center gap-4">
          <BandSwitcher onBandChange={handleBandChange} />
          {navLinks('inline')}
          <div className="h-5 w-px bg-border" aria-hidden="true" />
          <div className="flex flex-wrap items-center gap-2">{actionButtons}</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <Button
          ref={menuButtonRef}
          type="button"
          variant="outline"
          size="sm"
          aria-label={t('appHeader.openMenu')}
          onClick={() => setMenuOpen(true)}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </Button>
        <h1 className="text-xl font-medium">{title}</h1>
      </div>
      <Sheet
        open={menuOpen}
        onOpenChange={handleMenuOpenChange}
        title={
          <Link
            to="/dashboard"
            onClick={() => setMenuOpen(false)}
            aria-label={t('appHeader.goToDashboard')}
            className="rounded-md hover:underline"
          >
            Bandstand
          </Link>
        }
        closeLabel={t('common.close')}
        side="left"
      >
        {/* The separator before each section applies to whichever child
            actually renders first — not hardcoded onto the second and
            third the way it used to be. BandSwitcher renders nothing at
            all below two bands (see its own docstring), and hardcoding the
            border onto Navigation regardless left a stray empty "Band"
            heading over a blank gap whenever it did. */}
        <div className="[&>*+*]:mt-4 [&>*+*]:border-t [&>*+*]:border-border [&>*+*]:pt-4">
          <BandSwitcher onBandChange={handleBandChange} />
          <div>
            <SectionLabel>{t('appHeader.sectionNav')}</SectionLabel>
            <div className="mt-2">{navLinks('list', () => setMenuOpen(false))}</div>
          </div>
          <div>
            <SectionLabel>{t('appHeader.sectionActions')}</SectionLabel>
            <div className="mt-2 flex flex-col gap-2">
              {/* Same list-row look as the Band section above — a real page,
                  not an action, so it's a NavLink even though it now lives
                  next to sign-out rather than in the band-scoped list. */}
              <NavLink to="/settings" variant="list" onNavigate={() => setMenuOpen(false)}>
                {t('appHeader.accountSettings')}
              </NavLink>
              <Button variant="outline" onClick={handleSignOut} className="w-full">
                {t('appHeader.logout')}
              </Button>
            </div>
          </div>
        </div>
      </Sheet>
    </>
  );
}
