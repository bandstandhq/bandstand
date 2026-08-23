// SPDX-License-Identifier: Apache-2.0
import { createSetlist } from '@bandstand/core';
import type { Setlist } from '@bandstand/core';
import { Button, Input } from '@bandstand/ui';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useBandDoc } from '../hooks/useBandDoc';
import { useYMap } from '../hooks/useYMap';

export function SetlistList() {
  const { t } = useTranslation();
  const { bandId } = useParams<{ bandId: string }>();
  const { doc } = useBandDoc(bandId ?? null);
  const setlists = useYMap<Setlist>(doc?.getMap('setlists'));
  const [name, setName] = useState('');

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!doc || !name.trim()) return;
    createSetlist(doc, name.trim());
    setName('');
  }

  const entries = Object.entries(setlists);

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <Link to="/dashboard" className="text-sm text-muted-foreground hover:underline">
        &larr; {t('setlistList.back')}
      </Link>

      <h1 className="mt-4 text-xl font-medium">{t('setlistList.title')}</h1>

      <form onSubmit={handleCreate} className="mt-4 flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('setlistList.newPlaceholder')} className="w-64" />
        <Button type="submit" disabled={!name.trim()}>
          {t('setlistList.create')}
        </Button>
      </form>

      {entries.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">{t('setlistList.noSetlists')}</p>
      ) : (
        <ul className="mt-6 space-y-2">
          {entries.map(([setlistId, setlist]) => (
            <li key={setlistId} className="flex items-center justify-between rounded-md border border-border p-3">
              <span>{setlist.name}</span>
              <Link to={`/bands/${bandId}/setlists/${setlistId}`} className="text-sm text-primary hover:underline">
                {t('setlistList.open')}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
