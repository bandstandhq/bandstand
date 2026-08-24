// SPDX-License-Identifier: Apache-2.0
import { getDefaultVoiceId, itemsKey, stageAwarenessSchema } from '@bandstand/core';
import type { ContentVisibility, SetlistItem, Song, StageAwarenessState, TextSize, Theme, Voice } from '@bandstand/core';
import { buildRenderModel, parseChordPro, transposeChordPro } from '@bandstand/chords';
import type { RenderLine, RenderModel } from '@bandstand/chords';
import { Button } from '@bandstand/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { useBandDoc } from '../hooks/useBandDoc';
import { useWakeLock } from '../hooks/useWakeLock';
import { useYArray } from '../hooks/useYArray';
import { useYMap } from '../hooks/useYMap';
import { apiClient } from '../lib/api-client';
import { authClient } from '../lib/auth-client';

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

/**
 * This milestone doesn't yet track which content section is under the
 * viewport, so `sectionIndex` is always 0 and `fraction` stands in for
 * "how far through the whole item" rather than "through one section" —
 * see stagePosition.ts's own note that its internal shape is free to
 * change later behind the same type.
 */
function buildStagePayload(
  userId: string,
  setlistId: string,
  itemId: string,
  fraction: number,
  liveTranspose: number,
): StageAwarenessState {
  return stageAwarenessSchema.parse({
    userId,
    setlistId,
    itemId,
    position: { sectionIndex: 0, fraction: Math.max(0, Math.min(1, fraction)) },
    liveTranspose,
    isLeaderCandidate: true,
  });
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
  voice,
  visibility,
  chordColor,
  transposeSemitones,
  baseKey,
}: {
  voice: Voice;
  visibility: ContentVisibility;
  chordColor: string;
  transposeSemitones: number;
  baseKey: string;
}) {
  const { t } = useTranslation();
  const model: RenderModel | null = useMemo(() => {
    try {
      const parsed = parseChordPro(voice.body);
      const displayed = transposeSemitones !== 0 ? transposeChordPro(parsed, transposeSemitones, { key: baseKey }) : parsed;
      return buildRenderModel(displayed);
    } catch {
      return null;
    }
  }, [voice.body, transposeSemitones, baseKey]);

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
  const { doc, provider } = useBandDoc(bandId ?? null);
  const { data: session } = authClient.useSession();
  const localUserId = session?.user.id;
  useWakeLock(true);
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

  const [autoScroll, setAutoScroll] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(1);
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const scrollSpeedRef = useRef(scrollSpeed);
  const virtualElapsedMsRef = useRef(0);
  const liveTransposeRef = useRef(0);

  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [peerStates, setPeerStates] = useState<StageAwarenessState[]>([]);
  const [following, setFollowing] = useState<string | null>(null);
  const [pausedFollowUserId, setPausedFollowUserId] = useState<string | null>(null);
  const [showFollowPanel, setShowFollowPanel] = useState(false);

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
    });
  }, []);

  // Ephemeral — never persisted, and explicitly reset when leaving Stage
  // Mode rather than carried back out into the rest of the app.
  useEffect(() => {
    return () => setLiveTranspose(0);
  }, []);

  useEffect(() => {
    if (!bandId) return;
    apiClient.listBandMembers(bandId).then((members) => {
      setMemberNames(Object.fromEntries(members.map((member) => [member.userId, member.name])));
    });
  }, [bandId]);

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
  let currentSong: Song | undefined;
  if (currentItem?.type === 'song') {
    currentSong = songs[currentItem.songId];
    label = currentSong ? currentSong.title : currentItem.songId;
    voice = voices[getDefaultVoiceId(currentItem.songId)];
  } else if (currentItem?.type === 'break') {
    label = t('stageMode.breakMinutes', { minutes: currentItem.breakMinutes });
  } else if (currentItem?.type === 'finale') {
    label = t('stageMode.finale');
  }
  const canAutoScroll = Boolean(voice) && Boolean(currentSong?.durationSec) && !following;

  const displayedKey = useMemo(() => {
    if (!currentSong) return null;
    if (effectiveTranspose === 0) return currentSong.key;
    try {
      return transposeChordPro(parseChordPro(voice?.body ?? ''), effectiveTranspose, { key: currentSong.key }).key ?? currentSong.key;
    } catch {
      return currentSong.key;
    }
  }, [currentSong, voice, effectiveTranspose]);

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
  // fresh at the top), and throttled while the content area scrolls, so
  // band members can follow this session in Follow Mode.
  useEffect(() => {
    const awareness = provider?.awareness;
    if (!awareness || !localUserId || !setlistId || !currentItemId) return;
    awareness.setLocalStateField(
      'stage',
      buildStagePayload(localUserId, setlistId, currentItemId, 0, liveTransposeRef.current),
    );
  }, [provider, localUserId, setlistId, currentItemId]);

  useEffect(() => {
    const el = contentAreaRef.current;
    const awareness = provider?.awareness;
    if (!el || !awareness || !localUserId || !setlistId || !currentItemId) return undefined;
    const uid = localUserId;
    const sid = setlistId;
    const iid = currentItemId;
    let throttled = false;
    function handleScroll() {
      if (throttled) return;
      throttled = true;
      window.setTimeout(() => {
        throttled = false;
        if (!el || !awareness) return;
        const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
        const fraction = maxScroll > 0 ? el.scrollTop / maxScroll : 0;
        awareness.setLocalStateField('stage', buildStagePayload(uid, sid, iid, fraction, liveTransposeRef.current));
      }, POSITION_BROADCAST_THROTTLE_MS);
    }
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [provider, localUserId, setlistId, currentItemId]);

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

  // Mirror the followed peer's item and scroll position; if they've moved
  // to a different item, jump there first and mirror scroll once we land.
  useEffect(() => {
    if (!following) return;
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
    const el = contentAreaRef.current;
    if (el) {
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = peer.position.fraction * maxScroll;
    }
  }, [following, peerStates, currentItem?.id, items]);

  if (!bandId || !setlistId) return null;

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

      <div
        key={currentItem?.id}
        ref={contentAreaRef}
        className={`stage-item-transition flex flex-1 flex-col ${voice ? 'overflow-y-auto' : 'items-center justify-center'} p-8`}
      >
        <h1 className="text-center text-3xl font-semibold">{label}</h1>
        {voice && (
          <div className={`mt-6 ${TEXT_SIZE_CLASSES[textSize]} ${boldText ? 'font-bold' : 'font-normal'}`}>
            <SongContent
              voice={voice}
              visibility={contentVisibility}
              chordColor={chordColor}
              transposeSemitones={effectiveTranspose}
              baseKey={currentSong?.key ?? 'C'}
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
