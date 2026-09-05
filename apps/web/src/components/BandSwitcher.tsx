// SPDX-License-Identifier: Apache-2.0
import type { MyBand } from '@bandstand/api-client';
import type { Band } from '@bandstand/core';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@bandstand/ui';
import { Building2, Check, ChevronsUpDown, KeyRound, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CreateBandForm } from './CreateBandForm';
import { JoinBandForm } from './JoinBandForm';
import { apiClient } from '../lib/api-client';
import { bandOptionLabel } from '../lib/bandOptionLabel';
import { useActiveBandStore } from '../stores/activeBand';
import { useMyBandsStore } from '../stores/myBands';

/**
 * Which band you're currently looking at, shaped like shadcn's own sidebar
 * "team switcher" block — always rendered (even with a single band, even
 * with none yet), not hidden below two bands the way this used to work:
 * this is now the *only* place band switching lives, and doubles as the
 * quick way to create a new band or join one by invite code (Account
 * Settings still has its own copies of both forms too, for anyone who
 * lands there directly rather than through this dropdown).
 *
 * `onBandChange`, if given, is called whenever the selection changes with
 * the new band's id — AppSidebar/BottomNav use it to actually navigate
 * there. This component only ever manages *which band is remembered*
 * plus creating/joining new ones.
 *
 * `bands` lives in a shared store (stores/myBands.ts), not local state:
 * every page navigation remounts this component (PageShell is called by
 * each page individually, not a persistent layout route — see
 * PageShell.tsx), so local state would re-fetch and flash empty on every
 * single click between nav links. Reading from the store means a remount
 * renders instantly from whatever was last fetched, while this effect's
 * fetch quietly keeps it current in the background.
 */
export function BandSwitcher({
  collapsed,
  onBandChange,
  compact,
}: {
  collapsed?: boolean;
  onBandChange?: (bandId: string) => void;
  /**
   * BottomNav's "More" sheet is already fairly narrow — forcing the same
   * fixed 224px (`min-w-56`) desktop floor there leaves a lot of empty
   * trailing space after a short band name and reads as oversized (issue
   * #248). That floor exists only to stop the popup shrinking to the
   * sidebar's own collapsed, icon-only trigger width (#246) — a concern
   * that doesn't exist on mobile, since BottomNav never collapses its
   * trigger. Letting the popup size to its own content there (down to the
   * shared 128px `min-w-32` every dropdown already has) is enough.
   */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const bands = useMyBandsStore((s) => s.bands);
  const setBands = useMyBandsStore((s) => s.setBands);
  const upsertBand = useMyBandsStore((s) => s.upsertBand);
  const activeBandId = useActiveBandStore((s) => s.activeBandId);
  const setActiveBandId = useActiveBandStore((s) => s.setActiveBandId);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  function handleSelect(bandId: string) {
    setActiveBandId(bandId);
    onBandChange?.(bandId);
  }

  function handleCreated(band: Band) {
    const created: MyBand = { ...band, role: 'owner' };
    upsertBand(created);
    setCreateOpen(false);
    handleSelect(created.id);
  }

  function handleJoined(band: Band) {
    const joined: MyBand = { ...band, role: 'member' };
    upsertBand(joined);
    setJoinOpen(false);
    handleSelect(joined.id);
  }

  useEffect(() => {
    let cancelled = false;
    apiClient.listMyBands().then((result) => {
      if (cancelled) return;
      setBands(result);
      const validIds = new Set(result.map((b) => b.id));
      if (activeBandId && !validIds.has(activeBandId)) {
        // Stale — most commonly a previous user's last-active band still
        // sitting in persisted client state after a login/logout on this
        // device. Never trust it just because it's set; only a band the
        // *current* session is actually in counts.
        setActiveBandId(result[0]?.id ?? null);
      } else if (!activeBandId && result.length > 0) {
        setActiveBandId(result[0]!.id);
      }
    });
    return () => {
      cancelled = true;
    };
    // Deliberately only re-runs on mount: refetching every time
    // activeBandId changes would just re-fetch the same list. This never
    // calls onBandChange — reconciling a stale *remembered* band must not
    // itself navigate anyone away from whatever page they're legitimately
    // looking at right now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only the very first load, before the store has ever been populated —
  // unavoidable, there's genuinely no data yet. Every subsequent mount
  // reads the already-populated store instead of hitting this.
  if (bands === null) return null;

  const activeBand = bands.find((b) => b.id === activeBandId) ?? bands[0] ?? null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('bandSwitcher.label')}
            className={
              'flex items-center gap-2 rounded-md text-left text-sm font-medium text-foreground/90 transition-colors hover:bg-accent hover:text-foreground' +
              (collapsed ? ' justify-center px-2 py-2' : ' w-full px-2 py-2')
            }
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
              <Building2 className="h-4 w-4" aria-hidden="true" />
            </span>
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {activeBand ? bandOptionLabel(activeBand, bands) : t('bandSwitcher.noTeams')}
                  </span>
                  {activeBand && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {activeBand.role === 'owner'
                        ? t('bandSettings.members.roleOwner')
                        : activeBand.role === 'admin'
                          ? t('bandSettings.members.roleAdmin')
                          : t('bandSettings.members.roleMember')}
                    </span>
                  )}
                </span>
                <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className={compact ? undefined : 'min-w-56'}>
          <DropdownMenuLabel>{t('bandSwitcher.teamsLabel')}</DropdownMenuLabel>
          {bands.map((band) => (
            <DropdownMenuItem key={band.id} onSelect={() => handleSelect(band.id)} className="gap-2">
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{bandOptionLabel(band, bands)}</span>
              {band.id === activeBand?.id && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2"
            onSelect={(event) => {
              event.preventDefault();
              setJoinOpen(true);
            }}
          >
            <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t('bandSwitcher.joinBand')}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            onSelect={(event) => {
              event.preventDefault();
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t('bandSwitcher.createBand')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>{t('bandSwitcher.joinBand')}</DialogTitle>
          </DialogHeader>
          <JoinBandForm onJoined={handleJoined} />
        </DialogContent>
      </Dialog>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>{t('bandSwitcher.createBand')}</DialogTitle>
          </DialogHeader>
          <CreateBandForm onCreated={handleCreated} />
        </DialogContent>
      </Dialog>
    </>
  );
}
