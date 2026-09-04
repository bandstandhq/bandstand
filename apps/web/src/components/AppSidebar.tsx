// SPDX-License-Identifier: Apache-2.0
//
// Persistent desktop (≥640px) navigation column — the wide-screen half of
// what AppHeader used to render inline. Collapses to an icon-only rail via
// the sidebar-prefs store (Cmd/Ctrl+B, or the trigger button), persisted
// per-device. Narrow screens render BottomNav instead — see PageShell for
// the fork and why 640px is a different line from useIsWideScreen's 1024px.
import {
  Button,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenuButton,
  SidebarNav,
  SidebarTrigger,
} from '@bandstand/ui';
import { Calendar, ListMusic, ListOrdered, LogOut, Settings, UserCog } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { BandSwitcher } from './BandSwitcher';
import { useAppNavLinks } from '../hooks/useAppNavLinks';
import { useSidebarPrefsStore } from '../stores/sidebarPrefs';

export function AppSidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const { bandPath, navigateToBand, signOutAndReset } = useAppNavLinks();
  const collapsed = useSidebarPrefsStore((s) => s.collapsed);
  const toggle = useSidebarPrefsStore((s) => s.toggle);

  // Matches shadcn's own real sidebar convention — a keyboard shortcut for
  // a control that's otherwise a small icon button easy to miss.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        toggle();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle]);

  const navItems = [
    { to: bandPath('repertoire'), label: t('appHeader.repertoire'), icon: ListMusic },
    { to: bandPath('setlists'), label: t('appHeader.setlists'), icon: ListOrdered },
    { to: bandPath('calendar'), label: t('appHeader.calendar'), icon: Calendar },
    { to: bandPath('settings'), label: t('appHeader.bandSettings'), icon: Settings },
  ];

  return (
    <Sidebar collapsed={collapsed}>
      <SidebarHeader className={collapsed ? 'justify-center' : 'justify-between'}>
        {!collapsed && (
          <Link to="/dashboard" aria-label={t('appHeader.goToDashboard')} className="rounded-md font-medium hover:underline">
            Bandstand
          </Link>
        )}
        <SidebarTrigger
          collapsed={collapsed}
          expandLabel={t('appHeader.expandSidebar')}
          collapseLabel={t('appHeader.collapseSidebar')}
          onClick={toggle}
        />
      </SidebarHeader>
      <div className="border-b border-border p-2">
        <BandSwitcher collapsed={collapsed} onBandChange={navigateToBand} />
      </div>
      <SidebarContent>
        <SidebarNav aria-label={t('appHeader.navLabel')}>
          {navItems.map(({ to, label, icon: Icon }) => {
            const active = location.pathname === to || location.pathname.startsWith(`${to}/`);
            return (
              <SidebarMenuButton
                key={to}
                asChild
                collapsed={collapsed}
                active={active}
                title={collapsed ? label : undefined}
              >
                <Link to={to}>
                  <Icon aria-hidden="true" />
                  <span className={collapsed ? 'sr-only' : undefined}>{label}</span>
                </Link>
              </SidebarMenuButton>
            );
          })}
        </SidebarNav>
      </SidebarContent>
      <SidebarFooter className="flex flex-col gap-1">
        <SidebarMenuButton asChild collapsed={collapsed} title={collapsed ? t('appHeader.accountSettings') : undefined}>
          <Link to="/settings">
            <UserCog aria-hidden="true" />
            <span className={collapsed ? 'sr-only' : undefined}>{t('appHeader.accountSettings')}</span>
          </Link>
        </SidebarMenuButton>
        {/* An action, not a page — always a <Button>, same "nav links vs.
            actions" split AppHeader's own comment drew, never forced into
            the SidebarMenuButton nav-item styling used above. */}
        <Button
          variant="outline"
          size="sm"
          onClick={signOutAndReset}
          title={collapsed ? t('appHeader.logout') : undefined}
          aria-label={collapsed ? t('appHeader.logout') : undefined}
          className={collapsed ? 'w-9 justify-center px-0' : 'w-full justify-start gap-2'}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span className={collapsed ? 'sr-only' : undefined}>{t('appHeader.logout')}</span>
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
