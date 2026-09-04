// SPDX-License-Identifier: Apache-2.0
//
// Persistent desktop (≥640px) navigation bar — the wide-screen half of what
// AppHeader used to render inline, revived with the stage-2 icon set added
// to each link. Narrow screens render BottomNav instead — see PageShell for
// the fork.
import { Button } from '@bandstand/ui';
import { Calendar, ListMusic, ListOrdered, LogOut, Settings, UserCog } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { BandSwitcher } from './BandSwitcher';
import { useAppNavLinks } from '../hooks/useAppNavLinks';

function TopbarLink({ to, active, icon: Icon, children }: { to: string; active: boolean; icon: typeof Calendar; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={
        'flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-foreground/90 transition-colors hover:bg-accent hover:text-foreground' +
        (active ? ' bg-accent text-foreground' : '')
      }
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {children}
    </Link>
  );
}

export function AppTopbar({ title }: { title: ReactNode }) {
  const { t } = useTranslation();
  const location = useLocation();
  const { bandPath, navigateToBand, signOutAndReset } = useAppNavLinks();

  const navItems = [
    { to: bandPath('repertoire'), label: t('appHeader.repertoire'), icon: ListMusic },
    { to: bandPath('setlists'), label: t('appHeader.setlists'), icon: ListOrdered },
    { to: bandPath('calendar'), label: t('appHeader.calendar'), icon: Calendar },
    { to: bandPath('settings'), label: t('appHeader.bandSettings'), icon: Settings },
  ];

  return (
    <header className="border-b border-border">
      <div className="flex flex-wrap items-center gap-4 px-6 py-3">
        <Link to="/dashboard" aria-label={t('appHeader.goToDashboard')} className="rounded-md font-medium hover:underline">
          Bandstand
        </Link>
        <h1 className="text-xl font-medium">{title}</h1>
        <div className="ml-auto flex flex-wrap items-center gap-4">
          <BandSwitcher onBandChange={navigateToBand} />
          <nav className="flex flex-wrap items-center gap-1" aria-label={t('appHeader.navLabel')}>
            {navItems.map(({ to, label, icon }) => {
              const active = location.pathname === to || location.pathname.startsWith(`${to}/`);
              return (
                <TopbarLink key={to} to={to} active={active} icon={icon}>
                  {label}
                </TopbarLink>
              );
            })}
          </nav>
          <div className="h-5 w-px bg-border" aria-hidden="true" />
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/settings"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-foreground/90 transition-colors hover:bg-accent hover:text-foreground"
            >
              <UserCog className="h-4 w-4" aria-hidden="true" />
              {t('appHeader.accountSettings')}
            </Link>
            <Button variant="outline" size="sm" onClick={signOutAndReset}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {t('appHeader.logout')}
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
