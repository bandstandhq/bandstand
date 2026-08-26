// SPDX-License-Identifier: Apache-2.0
import {
  addSetlistItem,
  anchorsKey,
  applyAnchorToChordProPosition,
  applyAnchorToFilesPosition,
  applyPageSyncPosition,
  buildBreakItem,
  buildFinaleItem,
  buildSongItem,
  computeCurrentAnchorInChordPro,
  computeCurrentAnchorInFiles,
  computePageSyncPosition,
  createInitialStagePosition,
  determineSyncLevel,
  getAssignedVoiceId,
  isPageSyncAnchorId,
  itemsKey,
  matchAnchorsToChordProSections,
  moveSetlistItem,
  removeSetlistItem,
  resolveKnownAnchor,
  setVoiceAnchorPosition,
  stageAwarenessSchema,
  voiceSchema,
} from '@bandstand/core';
import type {
  Anchor,
  BandMember,
  ContentVisibility,
  SetlistItem,
  Song,
  SongChecklistItem,
  SongNote,
  StageAwarenessState,
  StagePosition,
  SyncLevel,
  TextSize,
  Theme,
  Voice,
} from '@bandstand/core';
import { buildRenderModel, normalizeKey, parseChordPro, shiftKeyBySemitones, transposeChordProToKey } from '@bandstand/chords';
import type { RenderLine, RenderModel } from '@bandstand/chords';
import { Button } from '@bandstand/ui';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { BandAccessDenied } from '../components/BandAccessDenied';
import { useBandDoc } from '../hooks/useBandDoc';
import { useWakeLock } from '../hooks/useWakeLock';
import { useYArray } from '../hooks/useYArray';
import { useYMap } from '../hooks/useYMap';
import { apiClient } from '../lib/api-client';
import { authClient } from '../lib/auth-client';
import type * as Y from 'yjs';

// Code-split: pdf.js is a large dependency most songs (plain ChordPro)
// never touch, so it shouldn't sit in the app's main bundle.
const PdfVoiceViewer = lazy(() => import('../components/PdfVoiceViewer').then((m) => ({ default: m.PdfVoiceViewer })));

const TEXT_SIZE_CLASSES: Record<TextSize, string> = {
  small: 'text-xl',
  medium: 'text-2xl',
  large: 'text-3xl',
  xlarge: 'text-4xl',
};

const TEXT_SIZES: TextSize[] = ['small', 'medium', 'large', 'xlarge'];
const CONTENT_VISIBILITIES: ContentVisibility[] = ['text', 'chords', 'both'];

const MIN_SCROLL_SPEED = 0.5;
const MAX_SCROLL_SPEED = 2.5;
const SCROLL_SPEED_STEP = 0.1;
const POSITION_BROADCAST_THROTTLE_MS = 250;

function buildStagePayload(
  userId: string,
  setlistId: string,
  itemId: string,
  position: StagePosition | undefined,
  liveTranspose: number,
): StageAwarenessState {
  return stageAwarenessSchema.parse({
    userId,
    setlistId,
    itemId,
    position,
    liveTranspose,
    isLeaderCandidate: true,
  });
}

/**
 * Which ChordPro section is at (or just above) the scrollable container's
 * current scroll position, and how far scrolled past it — the DOM
 * equivalent of `computeCurrentAnchorInChordPro`'s `ChordProViewState`.
 * Relies on each section in `SongContent` carrying a
 * `data-anchor-section-index` attribute. `undefined` if the content has no
 * sections at all (e.g. not rendered yet).
 */
function findCurrentChordProSection(container: HTMLElement): { sectionIndex: number; fractionInSection: number } | undefined {
  const sectionEls = Array.from(container.querySelectorAll<HTMLElement>('[data-anchor-section-index]'));
  if (sectionEls.length === 0) return undefined;

  const scrollTop = container.scrollTop;
  let currentIdx = 0;
  for (let i = 0; i < sectionEls.length; i++) {
    if (sectionEls[i]!.offsetTop <= scrollTop + 1) currentIdx = i;
    else break;
  }

  const currentTop = sectionEls[currentIdx]!.offsetTop;
  const nextTop = sectionEls[currentIdx + 1]?.offsetTop ?? container.scrollHeight;
  const span = Math.max(1, nextTop - currentTop);
  const fractionInSection = Math.min(1, Math.max(0, (scrollTop - currentTop) / span));
  const sectionIndex = Number(sectionEls[currentIdx]!.dataset.anchorSectionIndex);
  return { sectionIndex, fractionInSection };
}

/** Inverse of the above — scrolls to a `{sectionIndex, fractionInSection}` target, used when applying a followed peer's position. */
function scrollToChordProSection(container: HTMLElement, target: { sectionIndex: number; fractionInSection: number }): void {
  const sectionEls = Array.from(container.querySelectorAll<HTMLElement>('[data-anchor-section-index]'));
  const idx = sectionEls.findIndex((el) => Number(el.dataset.anchorSectionIndex) === target.sectionIndex);
  if (idx === -1) return;

  const currentTop = sectionEls[idx]!.offsetTop;
  const nextTop = sectionEls[idx + 1]?.offsetTop ?? container.scrollHeight;
  const span = Math.max(0, nextTop - currentTop);
  container.scrollTop = currentTop + target.fractionInSection * span;
}

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
  bandId,
  voiceId,
  voice,
  doc,
  visibility,
  chordColor,
  model,
  onPageChange,
  jumpToRenderedPosition,
}: {
  bandId: string;
  voiceId: string;
  voice: Voice;
  doc: Y.Doc;
  visibility: ContentVisibility;
  chordColor: string;
  /** Precomputed by StageMode, not here — Follow Mode's scroll-position tracking needs the exact same model to measure section boundaries against. */
  model: RenderModel | null;
  onPageChange?: (page: { fileIndex: number; pageNumberInFile: number }) => void;
  jumpToRenderedPosition?: number;
}) {
  const { t } = useTranslation();

  if (voice.kind === 'files') {
    return (
      <Suspense fallback={null}>
        <PdfVoiceViewer
          bandId={bandId}
          voiceId={voiceId}
          voice={voice}
          doc={doc}
          editable={false}
          onPageChange={onPageChange}
          jumpToRenderedPosition={jumpToRenderedPosition}
        />
      </Suspense>
    );
  }

  if (!model) {
    return <p className="text-center text-base opacity-70">{t('stageMode.contentError')}</p>;
  }

  return (
    <div className="mx-auto max-w-3xl leading-relaxed">
      {model.sections.map((section, sectionIndex) => (
        <div key={sectionIndex} data-anchor-section-index={sectionIndex} className="mb-6">
          {section.lines.map((line, lineIndex) => (
            <ContentLine key={lineIndex} line={line} visibility={visibility} chordColor={chordColor} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Metronome({ bpm, isDark }: { bpm: number; isDark: boolean }) {
  const { t } = useTranslation();
  const beatSeconds = 60 / bpm;
  return (
    <div className="flex items-center gap-2">
      <span
        className={`metronome-dot h-2.5 w-2.5 rounded-full ${isDark ? 'bg-white' : 'bg-black'}`}
        style={{ animationDuration: `${beatSeconds}s` }}
      />
      <span className={`text-xs tabular-nums ${isDark ? 'text-white/60' : 'text-black/60'}`}>{t('stageMode.bpm', { bpm })}</span>
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

function FollowPanel({
  isDark,
  peers,
  onFollow,
  onClose,
}: {
  isDark: boolean;
  peers: { userId: string; name: string }[];
  onFollow: (userId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const panelClass = isDark ? 'bg-neutral-900 text-white border-white/20' : 'bg-white text-black border-black/20';
  const rowHoverClass = isDark ? 'hover:bg-white/10' : 'hover:bg-black/10';

  return (
    <div className={`absolute right-4 top-16 z-10 w-56 space-y-2 rounded-md border p-4 ${panelClass}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{t('stageMode.follow')}</p>
        <button type="button" onClick={onClose} className="text-xs opacity-70 hover:opacity-100">
          {t('stageMode.close')}
        </button>
      </div>
      <ul className="space-y-1">
        {peers.map((peer) => (
          <li key={peer.userId}>
            <button
              type="button"
              onClick={() => onFollow(peer.userId)}
              className={`w-full rounded-md px-2 py-1 text-left text-sm ${rowHoverClass}`}
            >
              {peer.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Lernmodus (docs/adr/0010-anchor-sync.md): the leader half (announce an
 * anchor by tapping it) and the learner half (pick who to learn from, then
 * confirm/discard the page proposals the app quietly recorded) in one
 * panel — a rehearsal is exactly the setting where the same person plays
 * both roles across a session.
 */
function LernmodusPanel({
  isDark,
  anchors,
  onAnnounce,
  peers,
  learningFromUserId,
  onSetLearningFrom,
  proposals,
  onAccept,
  onDiscard,
  onClose,
}: {
  isDark: boolean;
  anchors: Anchor[];
  onAnnounce: (anchorId: string) => void;
  peers: { userId: string; name: string }[];
  learningFromUserId: string | null;
  onSetLearningFrom: (userId: string | null) => void;
  proposals: Record<string, { pageNumberInFile: number }>;
  onAccept: (anchorId: string) => void;
  onDiscard: (anchorId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const panelClass = isDark ? 'bg-neutral-900 text-white border-white/20' : 'bg-white text-black border-black/20';
  const rowClass = isDark ? 'border-white/10' : 'border-black/10';
  const fieldClass = isDark ? 'border-white/20 bg-transparent text-white' : 'border-black/20 bg-transparent text-black';
  const buttonBase = 'rounded-md border px-2 py-1 text-xs';
  const hoverClass = isDark ? 'hover:bg-white/10' : 'hover:bg-black/10';
  const proposalEntries = Object.entries(proposals);

  return (
    <div className={`absolute right-4 top-16 z-10 w-72 space-y-3 rounded-md border p-4 ${panelClass}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{t('stageMode.lernmodus')}</p>
        <button type="button" onClick={onClose} className="text-xs opacity-70 hover:opacity-100">
          {t('stageMode.close')}
        </button>
      </div>

      <div className="space-y-1">
        <p className="text-xs opacity-70">{t('stageMode.lernmodusAnnounce')}</p>
        {anchors.length === 0 ? (
          <p className="text-xs opacity-50">{t('stageMode.lernmodusNoAnchors')}</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {anchors.map((anchor) => (
              <button
                key={anchor.id}
                type="button"
                onClick={() => onAnnounce(anchor.id)}
                className={`${buttonBase} border ${rowClass} ${hoverClass}`}
              >
                {anchor.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1">
        <label className="block text-xs opacity-70" htmlFor="lernmodus-learn-from">
          {t('stageMode.lernmodusLearnFrom')}
        </label>
        <select
          id="lernmodus-learn-from"
          value={learningFromUserId ?? ''}
          onChange={(e) => onSetLearningFrom(e.target.value || null)}
          className={`h-8 w-full rounded-md border px-2 text-xs ${fieldClass}`}
        >
          <option value="">{t('stageMode.lernmodusLearnFromNone')}</option>
          {peers.map((peer) => (
            <option key={peer.userId} value={peer.userId}>
              {peer.name}
            </option>
          ))}
        </select>
      </div>

      {proposalEntries.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs opacity-70">{t('stageMode.lernmodusProposals')}</p>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {proposalEntries.map(([anchorId, position]) => (
              <li key={anchorId} className={`flex items-center justify-between border-b py-1 text-sm ${rowClass}`}>
                <span className="flex-1 truncate">
                  {t('stageMode.lernmodusProposal', {
                    label: anchors.find((a) => a.id === anchorId)?.label ?? anchorId,
                    page: position.pageNumberInFile,
                  })}
                </span>
                <span className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => onAccept(anchorId)} className={`${buttonBase} ${hoverClass}`}>
                    {t('stageMode.lernmodusAccept')}
                  </button>
                  <button type="button" onClick={() => onDiscard(anchorId)} className={`${buttonBase} ${hoverClass}`}>
                    {t('stageMode.lernmodusDiscard')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function itemLabel(
  t: (key: string, opts?: Record<string, unknown>) => string,
  item: SetlistItem,
  songs: Record<string, Song>,
): string {
  if (item.type === 'song') return songs[item.songId]?.title ?? item.songId;
  if (item.type === 'break') return t('stageMode.breakMinutes', { minutes: item.breakMinutes });
  return t('stageMode.finale');
}

function EditSetlistPanel({
  isDark,
  doc,
  setlistId,
  items,
  songs,
  onClose,
}: {
  isDark: boolean;
  doc: Y.Doc;
  setlistId: string;
  items: SetlistItem[];
  songs: Record<string, Song>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [pickedSongId, setPickedSongId] = useState('');
  const panelClass = isDark ? 'bg-neutral-900 text-white border-white/20' : 'bg-white text-black border-black/20';
  const rowClass = isDark ? 'border-white/10' : 'border-black/10';
  const buttonBase = 'rounded-md px-2 py-1 text-xs';
  const hoverClass = isDark ? 'hover:bg-white/10' : 'hover:bg-black/10';
  const poolSongs = Object.entries(songs).filter(([, song]) => song.status === 'active');

  function handleAddSong() {
    if (!pickedSongId) return;
    addSetlistItem(doc, setlistId, buildSongItem(pickedSongId));
    setPickedSongId('');
  }

  return (
    <div className={`absolute right-4 top-16 z-10 w-72 space-y-3 rounded-md border p-4 ${panelClass}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{t('stageMode.editSetlist')}</p>
        <button type="button" onClick={onClose} className="text-xs opacity-70 hover:opacity-100">
          {t('stageMode.close')}
        </button>
      </div>

      <ul className="max-h-60 space-y-1 overflow-y-auto">
        {items.map((item, index) => (
          <li key={item.id} className={`flex items-center justify-between border-b py-1 text-sm ${rowClass}`}>
            <span className="flex-1 truncate">{itemLabel(t, item, songs)}</span>
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => moveSetlistItem(doc, setlistId, item.id, index - 1)}
                aria-label={t('stageMode.moveUp')}
                className={`${buttonBase} ${hoverClass} disabled:opacity-30`}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={index === items.length - 1}
                onClick={() => moveSetlistItem(doc, setlistId, item.id, index + 1)}
                aria-label={t('stageMode.moveDown')}
                className={`${buttonBase} ${hoverClass} disabled:opacity-30`}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => removeSetlistItem(doc, setlistId, item.id)}
                aria-label={t('stageMode.removeItem')}
                className={`${buttonBase} ${hoverClass}`}
              >
                ✕
              </button>
            </span>
          </li>
        ))}
        {items.length === 0 && <li className="py-1 text-xs opacity-70">{t('stageMode.setlistEmpty')}</li>}
      </ul>

      <div className="flex gap-1">
        <select
          value={pickedSongId}
          onChange={(e) => setPickedSongId(e.target.value)}
          className={`h-8 flex-1 rounded-md border bg-transparent px-1 text-xs ${rowClass}`}
        >
          <option value="">{t('stageMode.addSong')}</option>
          {poolSongs.map(([songId, song]) => (
            <option key={songId} value={songId}>
              {song.title}
            </option>
          ))}
        </select>
        <button type="button" disabled={!pickedSongId} onClick={handleAddSong} className={`${buttonBase} ${hoverClass} disabled:opacity-30`}>
          {t('stageMode.add')}
        </button>
      </div>

      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => addSetlistItem(doc, setlistId, buildBreakItem(15))}
          className={`${buttonBase} border ${rowClass} ${hoverClass}`}
        >
          {t('setlistDetail.addBreak')}
        </button>
        <button
          type="button"
          onClick={() => addSetlistItem(doc, setlistId, buildFinaleItem())}
          className={`${buttonBase} border ${rowClass} ${hoverClass}`}
        >
          {t('setlistDetail.addFinale')}
        </button>
      </div>
    </div>
  );
}

const EMPTY_SONG_NOTE: SongNote = { notes: '', checklist: [] };

/**
 * Private to this user, for this song only — never synced to bandmates
 * (see the note on `user_prefs.songNotes` in the DB schema).
 */
function NotesPanel({
  isDark,
  songTitle,
  note,
  onChange,
  onClose,
}: {
  isDark: boolean;
  songTitle: string;
  note: SongNote;
  onChange: (note: SongNote) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [newItemText, setNewItemText] = useState('');
  const panelClass = isDark ? 'bg-neutral-900 text-white border-white/20' : 'bg-white text-black border-black/20';
  const fieldClass = isDark ? 'border-white/20 bg-transparent' : 'border-black/20 bg-transparent';
  const buttonBase = 'rounded-md px-2 py-1 text-xs';
  const hoverClass = isDark ? 'hover:bg-white/10' : 'hover:bg-black/10';

  function toggleItem(id: string) {
    onChange({
      ...note,
      checklist: note.checklist.map((item) => (item.id === id ? { ...item, done: !item.done } : item)),
    });
  }

  function removeItem(id: string) {
    onChange({ ...note, checklist: note.checklist.filter((item) => item.id !== id) });
  }

  function addItem() {
    if (!newItemText.trim()) return;
    const item: SongChecklistItem = { id: crypto.randomUUID(), text: newItemText.trim(), done: false };
    onChange({ ...note, checklist: [...note.checklist, item] });
    setNewItemText('');
  }

  return (
    <div className={`absolute right-4 top-16 z-10 w-72 space-y-3 rounded-md border p-4 ${panelClass}`}>
      <div className="flex items-center justify-between">
        <p className="truncate text-sm font-medium">{t('stageMode.notesFor', { title: songTitle })}</p>
        <button type="button" onClick={onClose} className="shrink-0 text-xs opacity-70 hover:opacity-100">
          {t('stageMode.close')}
        </button>
      </div>

      <textarea
        value={note.notes}
        onChange={(e) => onChange({ ...note, notes: e.target.value })}
        placeholder={t('stageMode.notesPlaceholder')}
        rows={4}
        className={`w-full rounded-md border p-2 text-xs ${fieldClass}`}
      />

      <ul className="max-h-40 space-y-1 overflow-y-auto">
        {note.checklist.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={item.done} onChange={() => toggleItem(item.id)} />
            <span className={`flex-1 truncate ${item.done ? 'opacity-50 line-through' : ''}`}>{item.text}</span>
            <button type="button" onClick={() => removeItem(item.id)} aria-label={t('stageMode.removeItem')} className={`${buttonBase} ${hoverClass}`}>
              ✕
            </button>
          </li>
        ))}
      </ul>

      <div className="flex gap-1">
        <input
          type="text"
          value={newItemText}
          onChange={(e) => setNewItemText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addItem();
          }}
          placeholder={t('stageMode.checklistPlaceholder')}
          className={`h-8 flex-1 rounded-md border px-2 text-xs ${fieldClass}`}
        />
        <button type="button" onClick={addItem} className={`${buttonBase} ${hoverClass}`}>
          {t('stageMode.add')}
        </button>
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
  const { doc, provider, status: docStatus } = useBandDoc(bandId ?? null);
  const { data: session } = authClient.useSession();
  const localUserId = session?.user.id;
  useWakeLock(true);

  // Which voice each member sees can be assigned per-song (see
  // docs/adr/0008-multi-voice-songs.md); a member's own instruments are
  // only the fallback guess when no explicit assignment exists. Fetched
  // once for every member, not just the local one — the sync-level
  // indicator (docs/adr/0010-anchor-sync.md) needs to resolve *present
  // peers'* voices too, to check whether everyone's on the identical file.
  const [members, setMembers] = useState<BandMember[]>([]);
  useEffect(() => {
    if (!bandId) return;
    apiClient.listBandMembers(bandId).then(setMembers);
  }, [bandId]);
  const myInstruments = members.find((m) => m.userId === localUserId)?.instruments ?? [];
  const songs = useYMap<Song>(doc?.getMap('songs'));
  // Raw Yjs values, not run through voiceSchema — see the matching comment
  // in SongEditor.tsx for why that parse has to happen here explicitly.
  const rawVoices = useYMap<unknown>(doc?.getMap('voices'));
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

  const [autoScroll, setAutoScroll] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(1);
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const scrollSpeedRef = useRef(scrollSpeed);
  const virtualElapsedMsRef = useRef(0);
  const liveTransposeRef = useRef(0);

  const memberNames = Object.fromEntries(members.map((member) => [member.userId, member.name]));
  const [peerStates, setPeerStates] = useState<StageAwarenessState[]>([]);
  const [following, setFollowing] = useState<string | null>(null);
  const [pausedFollowUserId, setPausedFollowUserId] = useState<string | null>(null);
  // The page currently on screen for a `files`-kind voice — PdfVoiceViewer
  // manages page navigation internally, so this is fed back up via its
  // onPageChange callback, purely for anchor-position broadcasting.
  const [currentFilesPage, setCurrentFilesPage] = useState<{ fileIndex: number; pageNumberInFile: number } | null>(null);
  // An imperative "jump to this rendered position" for Follow Mode applying
  // a peer's anchor to a `files` voice — see PdfVoiceViewer's own prop docs.
  const [jumpToRenderedPosition, setJumpToRenderedPosition] = useState<number | undefined>(undefined);
  // A dezent (non-blocking) hint shown when a followed peer's anchor isn't
  // known to this voice and we walked back to the nearest one that is — "no
  // error, no dialog" per the spec. Auto-dismisses itself.
  const [unknownAnchorHint, setUnknownAnchorHint] = useState<string | null>(null);
  const hintTimeoutRef = useRef<number | undefined>(undefined);
  const [showFollowPanel, setShowFollowPanel] = useState(false);

  // Lernmodus (docs/adr/0010-anchor-sync.md): a leader announces anchors by
  // tapping through them (showAnnouncePanel); anyone else with a `files`
  // voice can separately "learn" from that leader — turning their own pages
  // normally while the app quietly records which page was showing each time
  // a new anchor was announced, as a proposal to confirm individually,
  // never auto-applied. Deliberately independent of `following`/Follow
  // Mode: a learner is meant to browse for themselves, not be dragged along.
  const [learningFromUserId, setLearningFromUserId] = useState<string | null>(null);
  const [showLernmodusPanel, setShowLernmodusPanel] = useState(false);
  const [anchorProposals, setAnchorProposals] = useState<Record<string, { fileIndex: number; pageNumberInFile: number }>>({});
  const lastRecordedAnchorIdRef = useRef<string | null>(null);
  const [showEditSetlist, setShowEditSetlist] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [songNotesMap, setSongNotesMap] = useState<Record<string, SongNote>>({});
  const songNotesMapRef = useRef(songNotesMap);
  const saveNotesTimeoutRef = useRef<number | undefined>(undefined);

  // The user's standing preference, applied read-only here (edited from the
  // song editor). Live transpose is layered on top of it, ephemeral to this
  // Stage Mode session only — see the reset-on-exit effect below.
  const [personalTranspose, setPersonalTranspose] = useState(0);
  const [liveTranspose, setLiveTranspose] = useState(0);
  const effectiveTranspose = personalTranspose + liveTranspose;

  useEffect(() => {
    apiClient.getMyPrefs().then((prefs) => {
      setTheme(prefs.theme);
      setTextSize(prefs.textSize);
      setBoldText(prefs.boldText);
      setChordColor(prefs.chordColor);
      setContentVisibility(prefs.contentVisibility);
      setPersonalTranspose(prefs.personalTranspose);
      setSongNotesMap(prefs.songNotes);
    });
  }, []);

  useEffect(() => {
    songNotesMapRef.current = songNotesMap;
  }, [songNotesMap]);

  // Debounced so typing in the notes textarea doesn't fire a request per
  // keystroke — the panel closing or Stage Mode exiting doesn't flush this
  // early, so a save can be lost if either happens within the debounce
  // window; acceptable for private scratch notes, not worth the extra
  // complexity of a flush-on-unmount path here.
  function updateSongNote(songId: string, note: SongNote) {
    const next = { ...songNotesMapRef.current, [songId]: note };
    setSongNotesMap(next);
    window.clearTimeout(saveNotesTimeoutRef.current);
    saveNotesTimeoutRef.current = window.setTimeout(() => {
      apiClient.updateMyPrefs({ songNotes: songNotesMapRef.current }).catch(() => {});
    }, 600);
  }

  // Ephemeral — never persisted, and explicitly reset when leaving Stage
  // Mode rather than carried back out into the rest of the app.
  useEffect(() => {
    return () => setLiveTranspose(0);
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

  let label = '';
  let voice: Voice | undefined;
  let voiceId: string | undefined;
  let currentSong: Song | undefined;
  let currentSongId: string | undefined;
  if (currentItem?.type === 'song') {
    currentSong = songs[currentItem.songId];
    currentSongId = currentItem.songId;
    label = currentSong ? currentSong.title : currentItem.songId;
    voiceId = doc && localUserId ? getAssignedVoiceId(doc, currentItem.songId, localUserId, myInstruments) : undefined;
    const rawVoice = voiceId ? rawVoices[voiceId] : undefined;
    voice = rawVoice ? voiceSchema.parse(rawVoice) : undefined;
  } else if (currentItem?.type === 'break') {
    label = t('stageMode.breakMinutes', { minutes: currentItem.breakMinutes });
  } else if (currentItem?.type === 'finale') {
    label = t('stageMode.finale');
  }
  const canAutoScroll = Boolean(voice) && Boolean(currentSong?.durationSec) && !following;

  // Anchors are song-wide, not per-voice (docs/adr/0010-anchor-sync.md) —
  // fetched here, once, rather than inside SongContent, since Follow
  // Mode's own broadcast/apply logic needs them directly too.
  const anchors = useYArray<Anchor>(currentSongId && doc ? doc.getArray(anchorsKey(currentSongId)) : undefined).sort(
    (a, b) => a.order - b.order,
  );

  // Computed here rather than inside SongContent — Follow Mode's own
  // scroll-position tracking (below) has to measure section boundaries
  // against this exact model, not a second, possibly-differently-timed one.
  const chordProBody = voice?.kind === 'chordpro' ? voice.body : undefined;
  const baseKey = currentSong?.key ?? 'C';
  const hasCurrentSong = currentSong !== undefined;
  const model: RenderModel | null = useMemo(() => {
    if (chordProBody === undefined) return null;
    try {
      const parsed = parseChordPro(chordProBody);
      const normalizedBaseKey = normalizeKey(baseKey);
      const displayed =
        effectiveTranspose !== 0
          ? transposeChordProToKey(parsed, normalizedBaseKey, shiftKeyBySemitones(normalizedBaseKey, effectiveTranspose))
          : parsed;
      return buildRenderModel(displayed);
    } catch {
      return null;
    }
  }, [chordProBody, effectiveTranspose, baseKey]);

  const displayedKey = useMemo(() => {
    if (!hasCurrentSong) return null;
    const normalizedBaseKey = normalizeKey(baseKey);
    return effectiveTranspose === 0 ? normalizedBaseKey : shiftKeyBySemitones(normalizedBaseKey, effectiveTranspose);
  }, [hasCurrentSong, baseKey, effectiveTranspose]);

  // Which sync-fallback rung is active right now (docs/adr/0010-anchor-sync.md)
  // — purely informational, never gates whether Follow Mode is attempted.
  // Scoped to peers present on this exact item, not the whole band: someone
  // on a different song doesn't affect this song's sync level.
  function resolveVoiceSha256s(userId: string): string[] {
    if (!doc || !currentSongId) return [];
    const memberInstruments = members.find((m) => m.userId === userId)?.instruments;
    const assignedVoiceId = getAssignedVoiceId(doc, currentSongId, userId, memberInstruments);
    const rawVoice = assignedVoiceId ? rawVoices[assignedVoiceId] : undefined;
    const assignedVoice = rawVoice ? voiceSchema.parse(rawVoice) : undefined;
    return assignedVoice?.kind === 'files' ? assignedVoice.files.map((f) => f.sha256) : [];
  }
  const presentPeerUserIds = peerStates
    .filter((state) => state.setlistId === setlistId && state.itemId === currentItem?.id)
    .map((state) => state.userId);
  const resolvedVoices = localUserId
    ? [localUserId, ...presentPeerUserIds].map((userId) => ({ userId, sha256s: resolveVoiceSha256s(userId) }))
    : [];
  const syncLevel: SyncLevel | null = currentSongId
    ? determineSyncLevel({ anchors, resolvedVoices, online: docStatus === 'connected' })
    : null;

  useEffect(() => {
    scrollSpeedRef.current = scrollSpeed;
  }, [scrollSpeed]);

  useEffect(() => {
    liveTransposeRef.current = liveTranspose;
  }, [liveTranspose]);

  // Re-broadcasts just the transpose field on change, merged into whatever
  // position was last sent — changing key mid-song shouldn't snap the
  // scroll fraction back to 0.
  useEffect(() => {
    const awareness = provider?.awareness;
    if (!awareness) return;
    const current = awareness.getLocalState() as { stage?: StageAwarenessState } | null;
    if (!current?.stage) return;
    awareness.setLocalStateField('stage', { ...current.stage, liveTranspose });
  }, [provider, liveTranspose]);

  // A fresh item always starts scrolled to the top, at zero elapsed time —
  // whether auto-scroll itself stays on or off carries over across items,
  // matching a band playing straight through a set.
  useEffect(() => {
    virtualElapsedMsRef.current = 0;
  }, [currentItem?.id]);

  const currentSongDurationSec = currentSong?.durationSec;
  const currentItemId = currentItem?.id;
  useEffect(() => {
    if (!autoScroll || !canAutoScroll || !currentSongDurationSec) return undefined;
    const durationMs = currentSongDurationSec * 1000;
    let lastFrameMs = performance.now();
    let rafId = requestAnimationFrame(step);

    function step(nowMs: number) {
      virtualElapsedMsRef.current += (nowMs - lastFrameMs) * scrollSpeedRef.current;
      lastFrameMs = nowMs;
      const el = contentAreaRef.current;
      if (el) {
        const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
        const fraction = Math.min(1, virtualElapsedMsRef.current / durationMs);
        el.scrollTop = fraction * maxScroll;
      }
      if (virtualElapsedMsRef.current < durationMs) {
        rafId = requestAnimationFrame(step);
      }
    }

    return () => cancelAnimationFrame(rafId);
  }, [autoScroll, canAutoScroll, currentSongDurationSec, currentItem?.id]);

  // Any direct manual scroll gesture pauses auto-scroll and Follow Mode
  // rather than fighting them — resuming either is an explicit re-tap.
  useEffect(() => {
    const el = contentAreaRef.current;
    if (!el) return undefined;
    function pauseAutoScrollAndFollow() {
      setAutoScroll(false);
      setFollowing((current) => {
        if (current) setPausedFollowUserId(current);
        return null;
      });
    }
    el.addEventListener('wheel', pauseAutoScrollAndFollow, { passive: true });
    el.addEventListener('touchmove', pauseAutoScrollAndFollow, { passive: true });
    return () => {
      el.removeEventListener('wheel', pauseAutoScrollAndFollow);
      el.removeEventListener('touchmove', pauseAutoScrollAndFollow);
    };
  }, [currentItem?.id]);

  // Broadcast our own position — once whenever the item changes (starting
  // fresh at the first anchor, if any), throttled while a ChordPro voice's
  // content area scrolls, and whenever a `files` voice's current page
  // changes — so band members can follow this session in Follow Mode. Never
  // a page number or scroll pixel on the wire — only ever `{anchorId,
  // fraction}` or nothing at all (see docs/adr/0010-anchor-sync.md).
  useEffect(() => {
    const awareness = provider?.awareness;
    if (!awareness || !localUserId || !setlistId || !currentItemId) return;
    awareness.setLocalStateField(
      'stage',
      buildStagePayload(localUserId, setlistId, currentItemId, createInitialStagePosition(anchors[0]?.id), liveTransposeRef.current),
    );
    // `anchors` is a fresh array every render (useYArray) — re-run only when the actual anchor set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, localUserId, setlistId, currentItemId, anchors.map((a) => a.id).join(',')]);

  useEffect(() => {
    const el = contentAreaRef.current;
    const awareness = provider?.awareness;
    if (!el || !awareness || !localUserId || !setlistId || !currentItemId || voice?.kind !== 'chordpro' || !model) {
      return undefined;
    }
    const uid = localUserId;
    const sid = setlistId;
    const iid = currentItemId;
    const currentModel = model;
    let throttled = false;
    function handleScroll() {
      if (throttled) return;
      throttled = true;
      window.setTimeout(() => {
        throttled = false;
        if (!el || !awareness) return;
        const section = findCurrentChordProSection(el);
        const position =
          section && syncLevel === 'anchor' ? computeCurrentAnchorInChordPro(anchors, currentModel.sections, section) : undefined;
        awareness.setLocalStateField('stage', buildStagePayload(uid, sid, iid, position, liveTransposeRef.current));
      }, POSITION_BROADCAST_THROTTLE_MS);
    }
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, localUserId, setlistId, currentItemId, voice?.kind, model, syncLevel, anchors.map((a) => a.id).join(',')]);

  // `files` voices don't scroll their own page turns through this
  // component's content-area scroll listener (PdfVoiceViewer manages
  // paging internally) — a page change reported via onPageChange is this
  // voice kind's equivalent broadcast trigger.
  useEffect(() => {
    const awareness = provider?.awareness;
    if (!awareness || !localUserId || !setlistId || !currentItemId || voice?.kind !== 'files' || !currentFilesPage) {
      return;
    }
    const position =
      syncLevel === 'anchor'
        ? computeCurrentAnchorInFiles(anchors, voice.files, voice.anchorMap, {
            fileIndex: currentFilesPage.fileIndex,
            page: currentFilesPage.pageNumberInFile,
            yPct: 0,
          })
        : syncLevel === 'page'
          ? computePageSyncPosition(voice.files, currentFilesPage.fileIndex, currentFilesPage.pageNumberInFile)
          : undefined;
    awareness.setLocalStateField(
      'stage',
      buildStagePayload(localUserId, setlistId, currentItemId, position, liveTransposeRef.current),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, localUserId, setlistId, currentItemId, voice, currentFilesPage, syncLevel, anchors.map((a) => a.id).join(',')]);

  // A fresh item has no current page yet — otherwise a stale page from the
  // previous song's files voice would linger and broadcast a wrong position.
  useEffect(() => {
    // A fresh item is external state (the setlist's own ordering), not a
    // redundant re-derivation of local state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentFilesPage(null);
    setJumpToRenderedPosition(undefined);
  }, [currentItem?.id]);

  // Disappear from other members' followable list as soon as we leave.
  useEffect(() => {
    return () => {
      provider?.awareness?.setLocalStateField('stage', null);
    };
  }, [provider]);

  // Subscribe to every other connected session's broadcast position.
  useEffect(() => {
    const awareness = provider?.awareness;
    if (!awareness) return undefined;
    function handleChange() {
      const states = awareness!.getStates() as Map<number, { stage?: unknown }>;
      const next: StageAwarenessState[] = [];
      for (const [clientId, state] of states) {
        if (clientId === awareness!.clientID) continue;
        const parsed = stageAwarenessSchema.safeParse(state.stage);
        if (parsed.success) next.push(parsed.data);
      }
      setPeerStates(next);
    }
    awareness.on('change', handleChange);
    handleChange();
    return () => awareness.off('change', handleChange);
  }, [provider]);

  const followablePeers = useMemo(() => {
    const byUserId = new Map<string, { userId: string; name: string }>();
    for (const state of peerStates) {
      if (state.setlistId === setlistId && state.userId !== localUserId) {
        byUserId.set(state.userId, { userId: state.userId, name: memberNames[state.userId] ?? state.userId });
      }
    }
    return Array.from(byUserId.values());
  }, [peerStates, setlistId, localUserId, memberNames]);

  // Mirror the followed peer's item and anchor position; if they've moved to
  // a different item, jump there first and mirror position once we land. A
  // peer with no `position` at all (the song-only/offline fallback levels —
  // see docs/adr/0010-anchor-sync.md) still gets its item mirrored above,
  // just not a within-item position — everyone scrolls/pages for themselves.
  useEffect(() => {
    if (!following || !voice) return;
    const peer = peerStates.find((state) => state.userId === following);
    if (!peer) return;
    if (peer.itemId !== currentItem?.id) {
      const index = items.findIndex((item) => item.id === peer.itemId);
      // Syncing local navigation to the followed peer's broadcast position
      // (an external system), not a redundant re-derivation of local state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (index !== -1) setRequestedIndex(index);
      return;
    }
    if (!peer.position) return;

    // A page-sync pseudo-anchor (the "same file, no anchors" fallback
    // level) is never "unknown" — every present voice was already
    // confirmed identical for this level to be active at all, so it
    // resolves directly, no walk-back or hint involved.
    if (isPageSyncAnchorId(peer.position.anchorId)) {
      if (voice.kind !== 'files') return;
      const resolved = applyPageSyncPosition(voice.files, voice.displayRecipe, peer.position.anchorId);
      if (resolved) setJumpToRenderedPosition(resolved.position);
      return;
    }

    // A device that receives a real anchor its own voice doesn't know walks
    // back to the nearest earlier known one instead — no error, no dialog.
    const knownAnchorIds = new Set(
      voice.kind === 'chordpro'
        ? model
          ? [...matchAnchorsToChordProSections(anchors, model.sections).keys()]
          : []
        : Object.keys(voice.anchorMap ?? {}),
    );
    const isKnown = knownAnchorIds.has(peer.position.anchorId);
    const resolvedAnchorId = isKnown ? peer.position.anchorId : resolveKnownAnchor(anchors, knownAnchorIds, peer.position.anchorId);
    if (!resolvedAnchorId) return;

    if (!isKnown) {
      const anchorLabel = anchors.find((a) => a.id === resolvedAnchorId)?.label ?? resolvedAnchorId;
      setUnknownAnchorHint(t('stageMode.jumpedToNearestAnchor', { label: anchorLabel }));
      window.clearTimeout(hintTimeoutRef.current);
      hintTimeoutRef.current = window.setTimeout(() => setUnknownAnchorHint(null), 4000);
    }

    if (voice.kind === 'chordpro' && model) {
      const el = contentAreaRef.current;
      const target = applyAnchorToChordProPosition(anchors, model.sections, resolvedAnchorId, peer.position.fraction);
      if (el && target) scrollToChordProSection(el, target);
    } else if (voice.kind === 'files') {
      const resolved = applyAnchorToFilesPosition(voice.files, voice.displayRecipe, voice.anchorMap, resolvedAnchorId);
      if (resolved) setJumpToRenderedPosition(resolved.position);
    }
  }, [following, peerStates, currentItem?.id, items, voice, anchors, model, t]);

  // Lernmodus's recording half: whenever the leader we're learning from
  // announces a *new* real anchor (never a page-sync pseudo id — there's
  // nothing to calibrate there), note whatever page this device's own
  // `files` voice currently shows as a proposal. Never persisted until the
  // learner explicitly confirms it in the proposals panel.
  useEffect(() => {
    lastRecordedAnchorIdRef.current = null;
  }, [learningFromUserId, currentItem?.id]);

  useEffect(() => {
    if (!learningFromUserId || voice?.kind !== 'files' || !currentFilesPage) return;
    const leader = peerStates.find((state) => state.userId === learningFromUserId && state.itemId === currentItem?.id);
    const anchorId = leader?.position?.anchorId;
    if (!anchorId || isPageSyncAnchorId(anchorId) || anchorId === lastRecordedAnchorIdRef.current) return;
    lastRecordedAnchorIdRef.current = anchorId;
    const { fileIndex, pageNumberInFile } = currentFilesPage;
    setAnchorProposals((prev) => ({ ...prev, [anchorId]: { fileIndex, pageNumberInFile } }));
  }, [learningFromUserId, peerStates, currentItem?.id, voice?.kind, currentFilesPage]);

  function handleAcceptProposal(anchorId: string) {
    if (!voiceId || voice?.kind !== 'files') return;
    const proposal = anchorProposals[anchorId];
    if (!proposal) return;
    setVoiceAnchorPosition(doc!, voiceId, anchorId, { fileIndex: proposal.fileIndex, page: proposal.pageNumberInFile, yPct: 0 });
    setAnchorProposals((prev) => {
      const next = { ...prev };
      delete next[anchorId];
      return next;
    });
  }

  function handleDiscardProposal(anchorId: string) {
    setAnchorProposals((prev) => {
      const next = { ...prev };
      delete next[anchorId];
      return next;
    });
  }

  if (!bandId || !setlistId) return null;
  if (docStatus === 'forbidden') return <BandAccessDenied />;

  function startFollowing(userId: string) {
    setFollowing(userId);
    setPausedFollowUserId(null);
    setAutoScroll(false);
    setShowFollowPanel(false);
  }

  function stopFollowing() {
    setFollowing((current) => {
      if (current) setPausedFollowUserId(current);
      return null;
    });
  }

  function handleExit() {
    navigate(`/bands/${bandId}/setlists/${setlistId}`);
  }

  function announceAnchor(anchorId: string) {
    const awareness = provider?.awareness;
    if (!awareness || !localUserId || !setlistId || !currentItem?.id) return;
    awareness.setLocalStateField(
      'stage',
      buildStagePayload(localUserId, setlistId, currentItem.id, { anchorId, fraction: 0 }, liveTransposeRef.current),
    );
  }

  function adjustScrollSpeed(delta: number) {
    setScrollSpeed((speed) => Math.round(Math.min(MAX_SCROLL_SPEED, Math.max(MIN_SCROLL_SPEED, speed + delta)) * 10) / 10);
  }

  function adjustLiveTranspose(delta: number) {
    setLiveTranspose((current) => current + delta);
  }

  const isDark = theme === 'dark';
  const bgClass = isDark ? 'bg-black text-white' : 'bg-white text-black';
  const chromeHoverClass = isDark ? 'hover:bg-white/10' : 'hover:bg-black/10';
  const mutedClass = isDark ? 'text-white/60' : 'text-black/60';

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
          {currentSong && syncLevel && (
            <span className={`text-xs ${mutedClass}`} title={t(`stageMode.syncLevel_${syncLevel}_hint`)}>
              {t(`stageMode.syncLevel_${syncLevel}`)}
            </span>
          )}
          {currentSong && <Metronome bpm={currentSong.bpm} isDark={isDark} />}
          {currentSong && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => adjustLiveTranspose(-1)}
                aria-label={t('stageMode.transposeDown')}
                className={`rounded-md px-2 py-1 text-sm ${chromeHoverClass}`}
              >
                −
              </button>
              <span className={`text-xs tabular-nums ${mutedClass}`}>
                {t('stageMode.key', { key: displayedKey ?? '—' })}
                {liveTranspose !== 0 && ` (${liveTranspose > 0 ? '+' : ''}${liveTranspose})`}
              </span>
              <button
                type="button"
                onClick={() => adjustLiveTranspose(1)}
                aria-label={t('stageMode.transposeUp')}
                className={`rounded-md px-2 py-1 text-sm ${chromeHoverClass}`}
              >
                +
              </button>
            </div>
          )}
          {canAutoScroll && (
            <div className="flex items-center gap-1">
              {autoScroll && (
                <>
                  <button
                    type="button"
                    onClick={() => adjustScrollSpeed(-SCROLL_SPEED_STEP)}
                    aria-label={t('stageMode.scrollSlower')}
                    className={`rounded-md px-2 py-1 text-sm ${chromeHoverClass}`}
                  >
                    −
                  </button>
                  <span className={`text-xs tabular-nums ${mutedClass}`}>{scrollSpeed.toFixed(1)}×</span>
                  <button
                    type="button"
                    onClick={() => adjustScrollSpeed(SCROLL_SPEED_STEP)}
                    aria-label={t('stageMode.scrollFaster')}
                    className={`rounded-md px-2 py-1 text-sm ${chromeHoverClass}`}
                  >
                    +
                  </button>
                </>
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={() => setAutoScroll((v) => !v)}
                className={`${isDark ? 'text-white' : 'text-black'} ${chromeHoverClass}`}
              >
                {autoScroll ? t('stageMode.autoScrollPause') : t('stageMode.autoScrollStart')}
              </Button>
            </div>
          )}
          {following ? (
            <Button
              type="button"
              variant="ghost"
              onClick={stopFollowing}
              className={`${isDark ? 'text-white' : 'text-black'} ${chromeHoverClass}`}
            >
              {t('stageMode.following', { name: memberNames[following] ?? following })}
            </Button>
          ) : pausedFollowUserId ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => startFollowing(pausedFollowUserId)}
              className={`${isDark ? 'text-white' : 'text-black'} ${chromeHoverClass}`}
            >
              {t('stageMode.backTo', { name: memberNames[pausedFollowUserId] ?? pausedFollowUserId })}
            </Button>
          ) : (
            followablePeers.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowFollowPanel((v) => !v)}
                className={`${isDark ? 'text-white' : 'text-black'} ${chromeHoverClass}`}
              >
                {t('stageMode.follow')}
              </Button>
            )
          )}
          {currentSong && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowLernmodusPanel((v) => !v)}
              className={`${isDark ? 'text-white' : 'text-black'} ${chromeHoverClass}`}
            >
              {learningFromUserId ? t('stageMode.lernmodusLearningFrom', { name: memberNames[learningFromUserId] ?? learningFromUserId }) : t('stageMode.lernmodus')}
            </Button>
          )}
          {doc && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowEditSetlist((v) => !v)}
              className={`${isDark ? 'text-white' : 'text-black'} ${chromeHoverClass}`}
            >
              {t('stageMode.editSetlist')}
            </Button>
          )}
          {currentSong && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowNotes((v) => !v)}
              className={`${isDark ? 'text-white' : 'text-black'} ${chromeHoverClass}`}
            >
              {t('stageMode.notes')}
            </Button>
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

      {showFollowPanel && (
        <FollowPanel
          isDark={isDark}
          peers={followablePeers}
          onFollow={startFollowing}
          onClose={() => setShowFollowPanel(false)}
        />
      )}

      {showLernmodusPanel && (
        <LernmodusPanel
          isDark={isDark}
          anchors={anchors}
          onAnnounce={announceAnchor}
          peers={followablePeers}
          learningFromUserId={learningFromUserId}
          onSetLearningFrom={setLearningFromUserId}
          proposals={anchorProposals}
          onAccept={handleAcceptProposal}
          onDiscard={handleDiscardProposal}
          onClose={() => setShowLernmodusPanel(false)}
        />
      )}

      {showEditSetlist && doc && (
        <EditSetlistPanel
          isDark={isDark}
          doc={doc}
          setlistId={setlistId}
          items={items}
          songs={songs}
          onClose={() => setShowEditSetlist(false)}
        />
      )}

      {showNotes && currentSong && currentSongId && (
        <NotesPanel
          isDark={isDark}
          songTitle={currentSong.title}
          note={songNotesMap[currentSongId] ?? EMPTY_SONG_NOTE}
          onChange={(note) => updateSongNote(currentSongId, note)}
          onClose={() => setShowNotes(false)}
        />
      )}

      {unknownAnchorHint && (
        <div
          className={`absolute left-1/2 top-16 z-10 -translate-x-1/2 rounded-md border px-3 py-1.5 text-xs ${isDark ? 'border-white/20 bg-neutral-900 text-white' : 'border-black/20 bg-white text-black'}`}
        >
          {unknownAnchorHint}
        </div>
      )}

      <div
        key={currentItem?.id}
        ref={contentAreaRef}
        className={`stage-item-transition flex flex-1 flex-col ${voice ? 'overflow-y-auto' : 'items-center justify-center'} p-8`}
      >
        <h1 className="text-center text-3xl font-semibold">{label}</h1>
        {voice && voiceId && doc && (
          <div className={`mt-6 ${TEXT_SIZE_CLASSES[textSize]} ${boldText ? 'font-bold' : 'font-normal'}`}>
            <SongContent
              bandId={bandId}
              voiceId={voiceId}
              voice={voice}
              doc={doc}
              visibility={contentVisibility}
              chordColor={chordColor}
              model={model}
              onPageChange={setCurrentFilesPage}
              jumpToRenderedPosition={jumpToRenderedPosition}
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between p-4">
        <Button
          type="button"
          variant="ghost"
          disabled={currentIndex <= 0}
          onClick={() => {
            stopFollowing();
            setRequestedIndex((i) => Math.max(0, i - 1));
          }}
          className={`${isDark ? 'text-white' : 'text-black'} ${chromeHoverClass} disabled:opacity-30`}
        >
          {t('stageMode.previous')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={currentIndex >= items.length - 1}
          onClick={() => {
            stopFollowing();
            setRequestedIndex((i) => Math.min(items.length - 1, i + 1));
          }}
          className={`${isDark ? 'text-white' : 'text-black'} ${chromeHoverClass} disabled:opacity-30`}
        >
          {t('stageMode.next')}
        </Button>
      </div>
    </main>
  );
}
