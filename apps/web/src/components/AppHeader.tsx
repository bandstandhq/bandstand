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
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { BandSwitcher } from './BandSwitcher';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { authClient } from '../lib/auth-client';
import { deleteAllLocalBandData } from '../lib/yjs';
import { useActiveBandStore } from '../stores/activeBand';
import { useThemeStore } from '../stores/theme';

/** No icon library in this app — a plain inline glyph rather than a new dependency for one icon. */
function HamburgerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}

/** Marks a row as "goes to another page" in the menu's list style — never used on an action button. */
function ChevronRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

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
      className="flex items-center justify-between gap-2 rounded-md px-1 py-2.5 text-sm text-foreground/80 hover:text-foreground"
    >
      {children}
      <ChevronRightIcon />
    </Link>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</p>;
}

export function AppHeader({ title }: { title: ReactNode }) {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const activeBandId = useActiveBandStore((s) => s.activeBandId);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const isWide = useMediaQuery('(min-width: 640px)');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

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

  async function handleDeleteLocalData() {
    setMenuOpen(false);
    if (!session) return;
    if (!window.confirm(t('appHeader.deleteLocalDataConfirm'))) return;
    await deleteAllLocalBandData(session.user.id);
    window.alert(t('appHeader.deleteLocalDataDone'));
  }

  function handleToggleTheme() {
    setMenuOpen(false);
    toggleTheme();
  }

  function handleSignOut() {
    setMenuOpen(false);
    void authClient.signOut();
  }

  // Actions (do something in place) are always `<Button>`s, styled to
  // signal what kind of action: destructive gets the destructive variant,
  // everything else outline — never ghost, which is reserved for nav
  // links so the two categories read differently at a glance. Every
  // handler also closes the mobile menu (a no-op when already closed on a
  // wide screen) since none of these navigate away on their own.
  const actionButtons = (
    <>
      <Button variant="destructive" size="sm" onClick={() => void handleDeleteLocalData()}>
        {t('appHeader.deleteLocalData')}
      </Button>
      <Button variant="outline" size="sm" type="button" aria-pressed={theme === 'dark'} onClick={handleToggleTheme}>
        {theme === 'dark' ? t('appHeader.themeLight') : t('appHeader.themeDark')}
      </Button>
      <Button variant="outline" size="sm" onClick={handleSignOut}>
        {t('appHeader.logout')}
      </Button>
    </>
  );

  function navLinks(variant: 'inline' | 'list', onNavigate?: () => void) {
    if (!activeBandId) return null;
    return (
      <nav
        className={variant === 'inline' ? 'flex flex-wrap items-center gap-4' : 'flex flex-col divide-y divide-border'}
        aria-label={t('appHeader.navLabel')}
      >
        <NavLink to={`/bands/${activeBandId}/repertoire`} variant={variant} onNavigate={onNavigate}>
          {t('appHeader.repertoire')}
        </NavLink>
        <NavLink to={`/bands/${activeBandId}/setlists`} variant={variant} onNavigate={onNavigate}>
          {t('appHeader.setlists')}
        </NavLink>
        <NavLink to={`/bands/${activeBandId}/calendar`} variant={variant} onNavigate={onNavigate}>
          {t('appHeader.calendar')}
        </NavLink>
        <NavLink to={`/bands/${activeBandId}/settings`} variant={variant} onNavigate={onNavigate}>
          {t('appHeader.bandSettings')}
        </NavLink>
      </nav>
    );
  }

  if (isWide) {
    return (
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-xl font-medium">{title}</h1>
        <div className="ml-auto flex flex-wrap items-center gap-4">
          <BandSwitcher />
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
          <HamburgerIcon />
        </Button>
        <h1 className="text-xl font-medium">{title}</h1>
      </div>
      <Sheet
        open={menuOpen}
        onOpenChange={handleMenuOpenChange}
        title={t('appHeader.menuTitle')}
        closeLabel={t('common.close')}
        side="left"
      >
        <div>
          <SectionLabel>{t('appHeader.sectionBand')}</SectionLabel>
          <div className="mt-2">
            <BandSwitcher />
          </div>
        </div>
        {activeBandId && (
          <div className="mt-4 border-t border-border pt-4">
            <SectionLabel>{t('appHeader.sectionNav')}</SectionLabel>
            <div className="mt-2">{navLinks('list', () => setMenuOpen(false))}</div>
          </div>
        )}
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
          <SectionLabel>{t('appHeader.sectionActions')}</SectionLabel>
          {actionButtons}
        </div>
      </Sheet>
    </>
  );
}
