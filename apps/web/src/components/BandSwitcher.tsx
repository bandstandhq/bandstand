// SPDX-License-Identifier: Apache-2.0
import type { MyBand } from '@bandstand/api-client';
import type { Band } from '@bandstand/core';
import { Button, Input } from '@bandstand/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { JoinBandForm } from './JoinBandForm';
import { apiClient } from '../lib/api-client';
import { useActiveBandStore } from '../stores/activeBand';

type OpenPanel = 'none' | 'join' | 'create';

/**
 * The band-area cluster: switch between bands, join one, or create a new
 * one. "Create a new band" used to only exist for a user with zero bands
 * (CreateFirstBand's old name) — once you're in any band at all it became
 * unreachable, which is exactly the "how do I start a second band?" dead
 * end AppHeader's menu is meant to fix. Both toggles are always available
 * regardless of how many bands the user already has.
 *
 * `onBandChange`, if given, is called whenever the selection changes (the
 * select itself, joining, or creating) with the new band's id — AppHeader
 * uses it to actually navigate there. This component only ever manages
 * *which band is remembered*, never where the app navigates.
 */
export function BandSwitcher({ onBandChange }: { onBandChange?: (bandId: string) => void }) {
  const { t } = useTranslation();
  const [bands, setBands] = useState<MyBand[] | null>(null);
  const [openPanel, setOpenPanel] = useState<OpenPanel>('none');
  const activeBandId = useActiveBandStore((s) => s.activeBandId);
  const setActiveBandId = useActiveBandStore((s) => s.setActiveBandId);

  function handleJoined(band: Band) {
    setBands((prev) => [...(prev ?? []), { ...band, role: 'member' }]);
    setActiveBandId(band.id);
    onBandChange?.(band.id);
    setOpenPanel('none');
  }

  function handleCreated(band: Band) {
    setBands((prev) => [...(prev ?? []), { ...band, role: 'owner' }]);
    setActiveBandId(band.id);
    onBandChange?.(band.id);
    setOpenPanel('none');
  }

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

  if (bands === null) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {bands.length > 0 && (
          <select
            aria-label={t('bandSwitcher.label')}
            value={activeBandId ?? bands[0]!.id}
            onChange={(e) => handleSelect(e.target.value)}
            className="h-10 max-w-40 truncate rounded-md border border-border bg-background px-3 text-sm sm:max-w-xs"
          >
            {bands.map((band) => (
              <option key={band.id} value={band.id}>
                {band.name}
              </option>
            ))}
          </select>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={openPanel === 'join'}
          onClick={() => setOpenPanel(openPanel === 'join' ? 'none' : 'join')}
        >
          {t('bandSwitcher.joinBand')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={openPanel === 'create'}
          onClick={() => setOpenPanel(openPanel === 'create' ? 'none' : 'create')}
        >
          {t('bandSwitcher.createBandToggle')}
        </Button>
      </div>
      {openPanel === 'join' && <JoinBandForm onJoined={handleJoined} />}
      {openPanel === 'create' && <CreateBandForm onCreated={handleCreated} />}
    </div>
  );
}

function CreateBandForm({ onCreated }: { onCreated: (band: Band) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const band = await apiClient.createBand({ name });
      onCreated(band);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('bandSwitcher.newBandPlaceholder')}
        className="w-48"
      />
      <Button type="submit" size="sm" disabled={submitting || !name.trim()}>
        {submitting ? t('bandSwitcher.creating') : t('bandSwitcher.createBand')}
      </Button>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </form>
  );
}
