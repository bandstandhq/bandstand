// SPDX-License-Identifier: Apache-2.0
//
// Narrow-screen (<640px) nav — a hamburger button opening a Sheet drawer.
// Unchanged from what AppHeader used to render on narrow screens: same
// "Band sections" landmark, same links, same Account/sign-out section,
// same popstate/focus-return handling. Rendered by PageShell, which now
// owns the wide/narrow fork itself (see its own comment on why).
import { Button, Sheet } from '@bandstand/ui';
import { ChevronRight, Menu } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { BandSwitcher } from './BandSwitcher';
import { useAppNavLinks } from '../hooks/useAppNavLinks';

/**
 * A link to another page — plain text, deliberately never a `<Button>`, so
 * it can't be confused with something that performs an action in place.
 */
function NavLink({ to, onNavigate, children }: { to: string; onNavigate: () => void; children: ReactNode }) {
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

export function MobileNav({ title }: { title: ReactNode }) {
  const { t } = useTranslation();
  const { bandPath, navigateToBand, signOutAndReset } = useAppNavLinks();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  function handleBandChange(newBandId: string) {
    setMenuOpen(false);
    navigateToBand(newBandId);
  }

  function handleSignOut() {
    setMenuOpen(false);
    signOutAndReset();
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
    window.history.pushState({ mobileNavOpen: true }, '');
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
            <nav className="mt-2 flex flex-col divide-y divide-border" aria-label={t('appHeader.navLabel')}>
              <NavLink to={bandPath('repertoire')} onNavigate={() => setMenuOpen(false)}>
                {t('appHeader.repertoire')}
              </NavLink>
              <NavLink to={bandPath('setlists')} onNavigate={() => setMenuOpen(false)}>
                {t('appHeader.setlists')}
              </NavLink>
              <NavLink to={bandPath('calendar')} onNavigate={() => setMenuOpen(false)}>
                {t('appHeader.calendar')}
              </NavLink>
              <NavLink to={bandPath('settings')} onNavigate={() => setMenuOpen(false)}>
                {t('appHeader.bandSettings')}
              </NavLink>
            </nav>
          </div>
          <div>
            <SectionLabel>{t('appHeader.sectionActions')}</SectionLabel>
            <div className="mt-2 flex flex-col gap-2">
              {/* Same list-row look as the Band section above — a real page,
                  not an action, so it's a NavLink even though it now lives
                  next to sign-out rather than in the band-scoped list. */}
              <NavLink to="/settings" onNavigate={() => setMenuOpen(false)}>
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
