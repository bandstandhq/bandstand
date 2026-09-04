// SPDX-License-Identifier: Apache-2.0
//
// Narrow-screen (<640px) nav — a fixed bottom tab bar replacing the old
// hamburger+Sheet drawer entirely. 4 tabs go straight to a band section;
// the 5th ("More") opens a Sheet with the band switcher, Account settings,
// and Sign out — the same content the old hamburger menu showed, just
// reached from a tab instead of a top-left button. Rendered by PageShell,
// which owns the wide/narrow fork (see its own comment).
import { BottomNav as BottomNavRoot, BottomNavItem, Button, Sheet } from '@bandstand/ui';
import { Calendar, ChevronRight, ListMusic, ListOrdered, MoreHorizontal, Settings } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { BandSwitcher } from './BandSwitcher';
import { useAppNavLinks } from '../hooks/useAppNavLinks';

/**
 * A link to another page inside the "More" sheet — plain text, deliberately
 * never a `<Button>`, so it can't be confused with something that performs
 * an action in place. Same list-row look the old hamburger menu used.
 */
function SheetNavLink({ to, onNavigate, children }: { to: string; onNavigate: () => void; children: ReactNode }) {
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

export function BottomNav() {
  const { t } = useTranslation();
  const location = useLocation();
  const { bandPath, navigateToBand, signOutAndReset } = useAppNavLinks();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  const tabs = [
    { to: bandPath('repertoire'), label: t('appHeader.repertoire'), icon: ListMusic },
    { to: bandPath('setlists'), label: t('appHeader.setlists'), icon: ListOrdered },
    { to: bandPath('calendar'), label: t('appHeader.calendar'), icon: Calendar },
    { to: bandPath('settings'), label: t('appHeader.bandSettings'), icon: Settings },
  ];

  function handleBandChange(newBandId: string) {
    setMoreOpen(false);
    navigateToBand(newBandId);
  }

  function handleSignOut() {
    setMoreOpen(false);
    signOutAndReset();
  }

  // Same back-button/history dance MobileNav's hamburger Sheet used —
  // makes the phone/browser back button close the sheet instead of
  // leaving the page.
  const pushedHistoryRef = useRef(false);

  useEffect(() => {
    if (!moreOpen) return;
    window.history.pushState({ bottomNavMoreOpen: true }, '');
    pushedHistoryRef.current = true;

    function handlePopState() {
      pushedHistoryRef.current = false;
      setMoreOpen(false);
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [moreOpen]);

  const wasMoreOpenRef = useRef(false);
  useEffect(() => {
    if (wasMoreOpenRef.current && !moreOpen) {
      moreButtonRef.current?.focus();
    }
    wasMoreOpenRef.current = moreOpen;
  }, [moreOpen]);

  function handleMoreOpenChange(open: boolean) {
    if (open) {
      setMoreOpen(true);
      return;
    }
    if (pushedHistoryRef.current) {
      pushedHistoryRef.current = false;
      window.history.back();
    } else {
      setMoreOpen(false);
    }
  }

  return (
    <>
      <BottomNavRoot aria-label={t('appHeader.navLabel')}>
        {tabs.map(({ to, label, icon: Icon }) => {
          const active = location.pathname === to || location.pathname.startsWith(`${to}/`);
          return (
            <BottomNavItem key={to} asChild active={active}>
              <Link to={to}>
                <Icon aria-hidden="true" />
                {label}
              </Link>
            </BottomNavItem>
          );
        })}
        <BottomNavItem asChild active={moreOpen}>
          <button ref={moreButtonRef} type="button" onClick={() => setMoreOpen(true)}>
            <MoreHorizontal aria-hidden="true" />
            {t('appHeader.more')}
          </button>
        </BottomNavItem>
      </BottomNavRoot>
      <Sheet
        open={moreOpen}
        onOpenChange={handleMoreOpenChange}
        title={
          <Link to="/dashboard" onClick={() => setMoreOpen(false)} aria-label={t('appHeader.goToDashboard')} className="rounded-md hover:underline">
            Bandstand
          </Link>
        }
        closeLabel={t('common.close')}
        side="right"
      >
        <div className="[&>*+*]:mt-4 [&>*+*]:border-t [&>*+*]:border-border [&>*+*]:pt-4">
          <BandSwitcher onBandChange={handleBandChange} />
          <div>
            <SectionLabel>{t('appHeader.sectionActions')}</SectionLabel>
            <div className="mt-2 flex flex-col gap-2">
              <SheetNavLink to="/settings" onNavigate={() => setMoreOpen(false)}>
                {t('appHeader.accountSettings')}
              </SheetNavLink>
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
