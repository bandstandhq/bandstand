// SPDX-License-Identifier: Apache-2.0
import type { MyBand } from '@bandstand/api-client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@bandstand/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../lib/api-client';
import { bandOptionLabel } from '../lib/bandOptionLabel';
import { useActiveBandStore } from '../stores/activeBand';

/**
 * Which band you're currently looking at — nothing else. Joining or
 * creating a band lives in AccountSettings (1+ band) or DashboardRedirect's
 * own zero-band view instead: those aren't things a user reaches for
 * anywhere near as often as switching bands, so they don't belong cluttering
 * every page's header/menu (see the nav-cleanup ADR-equivalent discussion).
 * Renders nothing at all below two bands — with zero there's nothing to
 * switch between, and with exactly one there's nothing else it could show.
 *
 * `onBandChange`, if given, is called whenever the selection changes with
 * the new band's id — AppHeader uses it to actually navigate there. This
 * component only ever manages *which band is remembered*, never where the
 * app navigates.
 */
export function BandSwitcher({ onBandChange }: { onBandChange?: (bandId: string) => void }) {
  const { t } = useTranslation();
  const [bands, setBands] = useState<MyBand[] | null>(null);
  const activeBandId = useActiveBandStore((s) => s.activeBandId);
  const setActiveBandId = useActiveBandStore((s) => s.setActiveBandId);

  function handleSelect(bandId: string) {
    setActiveBandId(bandId);
    onBandChange?.(bandId);
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

  if (bands === null || bands.length < 2) return null;

  return (
    <Select value={activeBandId ?? bands[0]!.id} onValueChange={handleSelect}>
      <SelectTrigger aria-label={t('bandSwitcher.label')} className="max-w-40 sm:max-w-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {bands.map((band) => (
          <SelectItem key={band.id} value={band.id}>
            {bandOptionLabel(band, bands)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
