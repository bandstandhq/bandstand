// SPDX-License-Identifier: Apache-2.0
import { getDefaultVoiceId, itemsKey } from '@bandstand/core';
import type { ContentVisibility, SetlistItem, Song, TextSize, Theme, Voice } from '@bandstand/core';
import { buildRenderModel, parseChordPro } from '@bandstand/chords';
import type { RenderLine, RenderModel } from '@bandstand/chords';
import { Button } from '@bandstand/ui';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { useBandDoc } from '../hooks/useBandDoc';
import { useYArray } from '../hooks/useYArray';
import { useYMap } from '../hooks/useYMap';
import { apiClient } from '../lib/api-client';

const TEXT_SIZE_CLASSES: Record<TextSize, string> = {
  small: 'text-xl',
  medium: 'text-2xl',
  large: 'text-3xl',
  xlarge: 'text-4xl',
};

const TEXT_SIZES: TextSize[] = ['small', 'medium', 'large', 'xlarge'];
const CONTENT_VISIBILITIES: ContentVisibility[] = ['text', 'chords', 'both'];

function ContentLine({ line, visibility, chordColor }: { line: RenderLine; visibility: ContentVisibility; chordColor: string }) {
  if (visibility === 'chords') {
    const chords = line.segments.map((segment) => segment.chord).filter((chord): chord is string => Boolean(chord));
    if (chords.length === 0) return <div>&nbsp;</div>;
    return (
      <div className="font-semibold" style={{ color: chordColor }}>
        {chords.join('  ')}
      </div>
    );
  }

  if (visibility === 'text') {
    const lyric = line.segments.map((segment) => segment.lyric).join('');
    return <div className="whitespace-pre-wrap">{lyric || ' '}</div>;
  }

  return (
    <div>
      {line.segments.map((segment, segmentIndex) => (
        <span key={segmentIndex} className="relative inline-block pt-[0.9em] align-bottom">
          {segment.chord && (
            <span className="absolute left-0 top-0 text-[0.6em] font-semibold" style={{ color: chordColor }}>
              {segment.chord}
            </span>
          )}
          <span className="whitespace-pre">{segment.lyric || ' '}</span>
        </span>
      ))}
    </div>
  );
}

function SongContent({
  voice,
  visibility,
  chordColor,
}: {
  voice: Voice;
  visibility: ContentVisibility;
  chordColor: string;
}) {
  const { t } = useTranslation();
  const model: RenderModel | null = useMemo(() => {
    try {
      return buildRenderModel(parseChordPro(voice.body));
    } catch {
      return null;
    }
  }, [voice.body]);

  if (!model) {
    return <p className="text-center text-base opacity-70">{t('stageMode.contentError')}</p>;
  }

  return (
    <div className="mx-auto max-w-3xl leading-relaxed">
      {model.sections.map((section, sectionIndex) => (
        <div key={sectionIndex} className="mb-6">
          {section.lines.map((line, lineIndex) => (
            <ContentLine key={lineIndex} line={line} visibility={visibility} chordColor={chordColor} />
          ))}
        </div>
      ))}
    </div>
  );
}

function SettingsPanel({
  theme,
  textSize,
  boldText,
  chordColor,
  contentVisibility,
  onChange,
  onClose,
}: {
  theme: Theme;
  textSize: TextSize;
  boldText: boolean;
  chordColor: string;
  contentVisibility: ContentVisibility;
  onChange: (patch: Partial<{ theme: Theme; textSize: TextSize; boldText: boolean; chordColor: string; contentVisibility: ContentVisibility }>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isDark = theme === 'dark';
  const panelClass = isDark ? 'bg-neutral-900 text-white border-white/20' : 'bg-white text-black border-black/20';
  const buttonBase = 'rounded-md border px-2 py-1 text-xs';
  const activeClass = isDark ? 'border-white bg-white/20' : 'border-black bg-black/10';
  const inactiveClass = isDark ? 'border-white/20' : 'border-black/20';

  return (
    <div className={`absolute right-4 top-16 z-10 w-64 space-y-4 rounded-md border p-4 ${panelClass}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{t('stageMode.settings')}</p>
        <button type="button" onClick={onClose} className="text-xs opacity-70 hover:opacity-100">
          {t('stageMode.close')}
        </button>
      </div>

      <div className="space-y-1">
        <p className="text-xs opacity-70">{t('stageMode.contentVisibility')}</p>
        <div className="flex gap-1">
          {CONTENT_VISIBILITIES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ contentVisibility: value })}
              className={`${buttonBase} ${contentVisibility === value ? activeClass : inactiveClass}`}
            >
              {t(`stageMode.contentVisibility_${value}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-xs opacity-70">{t('stageMode.textSize')}</p>
        <div className="flex gap-1">
          {TEXT_SIZES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ textSize: value })}
              className={`${buttonBase} ${textSize === value ? activeClass : inactiveClass}`}
            >
              {t(`stageMode.textSize_${value}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs opacity-70">{t('stageMode.boldText')}</p>
        <button
          type="button"
          onClick={() => onChange({ boldText: !boldText })}
          className={`${buttonBase} ${boldText ? activeClass : inactiveClass}`}
        >
          {boldText ? t('stageMode.on') : t('stageMode.off')}
        </button>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs opacity-70">{t('stageMode.theme')}</p>
        <button
          type="button"
          onClick={() => onChange({ theme: isDark ? 'light' : 'dark' })}
          className={`${buttonBase} ${inactiveClass}`}
        >
          {isDark ? t('stageMode.themeDark') : t('stageMode.themeLight')}
        </button>
      </div>

      <div className="flex items-center justify-between">
        <label htmlFor="stage-chord-color" className="text-xs opacity-70">
          {t('stageMode.chordColor')}
        </label>
        <input
          id="stage-chord-color"
          type="color"
          value={chordColor}
          onChange={(e) => onChange({ chordColor: e.target.value })}
          className="h-7 w-10 cursor-pointer rounded border-0 bg-transparent"
        />
      </div>
    </div>
  );
}

/**
 * Full-screen, no navigation chrome — the brief is explicit that this is
 * the actual reason the app exists, "no compromises." Renders the current
 * item's ChordPro content (via its default voice) with the user's display
 * preferences from `user_prefs`. Auto-scroll, the metronome, Follow Mode,
 * and live transpose are separate, later steps.
 */
export function StageMode() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { bandId, setlistId, itemId } = useParams<{ bandId: string; setlistId: string; itemId: string }>();
  const { doc } = useBandDoc(bandId ?? null);
  const songs = useYMap<Song>(doc?.getMap('songs'));
  const voices = useYMap<Voice>(doc?.getMap('voices'));
  const items = useYArray<SetlistItem>(setlistId ? doc?.getArray(itemsKey(setlistId)) : undefined);

  const startIndex = useMemo(() => {
    const index = items.findIndex((item) => item.id === itemId);
    return index === -1 ? 0 : index;
  }, [items, itemId]);
  const [requestedIndex, setRequestedIndex] = useState(startIndex);
  const currentIndex = Math.max(0, Math.min(requestedIndex, items.length - 1));
  const currentItem = items[currentIndex];

  const [theme, setTheme] = useState<Theme>('dark');
  const [textSize, setTextSize] = useState<TextSize>('medium');
  const [boldText, setBoldText] = useState(false);
  const [chordColor, setChordColor] = useState('#3b82f6');
  const [contentVisibility, setContentVisibility] = useState<ContentVisibility>('both');
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    apiClient.getMyPrefs().then((prefs) => {
      setTheme(prefs.theme);
      setTextSize(prefs.textSize);
      setBoldText(prefs.boldText);
      setChordColor(prefs.chordColor);
      setContentVisibility(prefs.contentVisibility);
    });
  }, []);

  function handleSettingsChange(patch: Partial<{ theme: Theme; textSize: TextSize; boldText: boolean; chordColor: string; contentVisibility: ContentVisibility }>) {
    if (patch.theme !== undefined) setTheme(patch.theme);
    if (patch.textSize !== undefined) setTextSize(patch.textSize);
    if (patch.boldText !== undefined) setBoldText(patch.boldText);
    if (patch.chordColor !== undefined) setChordColor(patch.chordColor);
    if (patch.contentVisibility !== undefined) setContentVisibility(patch.contentVisibility);
    apiClient.updateMyPrefs(patch).catch(() => {
      // Best-effort — the view already reflects the change locally.
    });
  }

  if (!bandId || !setlistId) return null;

  function handleExit() {
    navigate(`/bands/${bandId}/setlists/${setlistId}`);
  }

  const isDark = theme === 'dark';
  const bgClass = isDark ? 'bg-black text-white' : 'bg-white text-black';
  const chromeHoverClass = isDark ? 'hover:bg-white/10' : 'hover:bg-black/10';
  const mutedClass = isDark ? 'text-white/60' : 'text-black/60';

  let label = '';
  let voice: Voice | undefined;
  if (currentItem?.type === 'song') {
    const song = songs[currentItem.songId];
    label = song ? song.title : currentItem.songId;
    voice = voices[getDefaultVoiceId(currentItem.songId)];
  } else if (currentItem?.type === 'break') {
    label = t('stageMode.breakMinutes', { minutes: currentItem.breakMinutes });
  } else if (currentItem?.type === 'finale') {
    label = t('stageMode.finale');
  }

  return (
    <main className={`fixed inset-0 flex flex-col ${bgClass}`}>
      <div className="flex items-center justify-between p-4">
        <Button type="button" variant="ghost" onClick={handleExit} className={`${isDark ? 'text-white' : 'text-black'} ${chromeHoverClass}`}>
          {t('stageMode.exit')}
        </Button>
        <div className="flex items-center gap-3">
          {items.length > 0 && (
            <span className={`text-sm ${mutedClass}`}>
              {t('stageMode.positionCount', { current: currentIndex + 1, total: items.length })}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowSettings((v) => !v)}
            className={`${isDark ? 'text-white' : 'text-black'} ${chromeHoverClass}`}
          >
            {t('stageMode.settings')}
          </Button>
        </div>
      </div>

      {showSettings && (
        <SettingsPanel
          theme={theme}
          textSize={textSize}
          boldText={boldText}
          chordColor={chordColor}
          contentVisibility={contentVisibility}
          onChange={handleSettingsChange}
          onClose={() => setShowSettings(false)}
        />
      )}

      <div
        key={currentItem?.id}
        className={`stage-item-transition flex flex-1 flex-col ${voice ? 'overflow-y-auto' : 'items-center justify-center'} p-8`}
      >
        <h1 className="text-center text-3xl font-semibold">{label}</h1>
        {voice && (
          <div className={`mt-6 ${TEXT_SIZE_CLASSES[textSize]} ${boldText ? 'font-bold' : 'font-normal'}`}>
            <SongContent voice={voice} visibility={contentVisibility} chordColor={chordColor} />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between p-4">
        <Button
          type="button"
          variant="ghost"
          disabled={currentIndex <= 0}
          onClick={() => setRequestedIndex((i) => Math.max(0, i - 1))}
          className={`${isDark ? 'text-white' : 'text-black'} ${chromeHoverClass} disabled:opacity-30`}
        >
          {t('stageMode.previous')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={currentIndex >= items.length - 1}
          onClick={() => setRequestedIndex((i) => Math.min(items.length - 1, i + 1))}
          className={`${isDark ? 'text-white' : 'text-black'} ${chromeHoverClass} disabled:opacity-30`}
        >
          {t('stageMode.next')}
        </Button>
      </div>
    </main>
  );
}
