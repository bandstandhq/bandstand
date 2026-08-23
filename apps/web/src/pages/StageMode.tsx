// SPDX-License-Identifier: Apache-2.0
import { itemsKey } from '@bandstand/core';
import type { SetlistItem, Song } from '@bandstand/core';
import { Button } from '@bandstand/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { useBandDoc } from '../hooks/useBandDoc';
import { useYArray } from '../hooks/useYArray';
import { useYMap } from '../hooks/useYMap';

/**
 * Full-screen, no navigation chrome, dark — the brief is explicit that
 * this is the actual reason the app exists, "no compromises." This step
 * is the shell: entering at a specific item, moving to the next/previous
 * item, and getting back out. Text/chord rendering, sizing, auto-scroll,
 * the metronome, and Follow Mode are separate, later steps.
 */
export function StageMode() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { bandId, setlistId, itemId } = useParams<{ bandId: string; setlistId: string; itemId: string }>();
  const { doc } = useBandDoc(bandId ?? null);
  const songs = useYMap<Song>(doc?.getMap('songs'));
  const items = useYArray<SetlistItem>(setlistId ? doc?.getArray(itemsKey(setlistId)) : undefined);

  const startIndex = useMemo(() => {
    const index = items.findIndex((item) => item.id === itemId);
    return index === -1 ? 0 : index;
  }, [items, itemId]);
  const [requestedIndex, setRequestedIndex] = useState(startIndex);
  const currentIndex = Math.max(0, Math.min(requestedIndex, items.length - 1));
  const currentItem = items[currentIndex];

  if (!bandId || !setlistId) return null;

  function handleExit() {
    navigate(`/bands/${bandId}/setlists/${setlistId}`);
  }

  let label = '';
  if (currentItem?.type === 'song') {
    const song = songs[currentItem.songId];
    label = song ? song.title : currentItem.songId;
  } else if (currentItem?.type === 'break') {
    label = t('stageMode.breakMinutes', { minutes: currentItem.breakMinutes });
  } else if (currentItem?.type === 'finale') {
    label = t('stageMode.finale');
  }

  return (
    <main className="fixed inset-0 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between p-4">
        <Button type="button" variant="ghost" onClick={handleExit} className="text-white hover:bg-white/10">
          {t('stageMode.exit')}
        </Button>
        {items.length > 0 && (
          <span className="text-sm text-white/60">
            {t('stageMode.positionCount', { current: currentIndex + 1, total: items.length })}
          </span>
        )}
      </div>

      <div key={currentItem?.id} className="stage-item-transition flex flex-1 items-center justify-center p-8">
        <h1 className="text-center text-4xl font-semibold">{label}</h1>
      </div>

      <div className="flex items-center justify-between p-4">
        <Button
          type="button"
          variant="ghost"
          disabled={currentIndex <= 0}
          onClick={() => setRequestedIndex((i) => Math.max(0, i - 1))}
          className="text-white hover:bg-white/10 disabled:opacity-30"
        >
          {t('stageMode.previous')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={currentIndex >= items.length - 1}
          onClick={() => setRequestedIndex((i) => Math.min(items.length - 1, i + 1))}
          className="text-white hover:bg-white/10 disabled:opacity-30"
        >
          {t('stageMode.next')}
        </Button>
      </div>
    </main>
  );
}
