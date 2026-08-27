// SPDX-License-Identifier: Apache-2.0
import type { MyBand } from '@bandstand/api-client';
import type { Band } from '@bandstand/core';
import { Button, Input } from '@bandstand/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { JoinBandForm } from './JoinBandForm';
import { apiClient } from '../lib/api-client';
import { useActiveBandStore } from '../stores/activeBand';

export function BandSwitcher() {
  const { t } = useTranslation();
  const [bands, setBands] = useState<MyBand[] | null>(null);
  const [showJoinForm, setShowJoinForm] = useState(false);
  const activeBandId = useActiveBandStore((s) => s.activeBandId);
  const setActiveBandId = useActiveBandStore((s) => s.setActiveBandId);

  function handleJoined(band: Band) {
    setBands((prev) => [...(prev ?? []), { ...band, role: 'member' }]);
    setActiveBandId(band.id);
    setShowJoinForm(false);
  }

  useEffect(() => {
    let cancelled = false;
    apiClient.listMyBands().then((result) => {
      if (cancelled) return;
      setBands(result);
      if (!activeBandId && result.length > 0) {
        setActiveBandId(result[0]!.id);
      }
    });
    return () => {
      cancelled = true;
    };
    // Deliberately only re-runs on mount: refetching every time
    // activeBandId changes would just re-fetch the same list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (bands === null) return null;

  if (bands.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <CreateFirstBand
          onCreated={(band) => {
            setBands([{ ...band, role: 'owner' }]);
            setActiveBandId(band.id);
          }}
        />
        <p className="text-xs text-muted-foreground">{t('bandSwitcher.or')}</p>
        <JoinBandForm onJoined={handleJoined} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label={t('bandSwitcher.label')}
        value={activeBandId ?? bands[0]!.id}
        onChange={(e) => setActiveBandId(e.target.value)}
        className="h-10 max-w-40 truncate rounded-md border border-border bg-background px-3 text-sm sm:max-w-xs"
      >
        {bands.map((band) => (
          <option key={band.id} value={band.id}>
            {band.name}
          </option>
        ))}
      </select>
      {showJoinForm ? (
        <JoinBandForm onJoined={handleJoined} />
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setShowJoinForm(true)}>
          {t('bandSwitcher.joinBand')}
        </Button>
      )}
    </div>
  );
}

function CreateFirstBand({ onCreated }: { onCreated: (band: Band) => void }) {
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
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('bandSwitcher.newBandPlaceholder')}
        className="w-48"
      />
      <Button type="submit" disabled={submitting || !name.trim()} size="sm">
        {submitting ? t('bandSwitcher.creating') : t('bandSwitcher.createBand')}
      </Button>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </form>
  );
}
