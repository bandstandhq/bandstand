// SPDX-License-Identifier: Apache-2.0
import { addSong, getDefaultVoiceId, setSongStatus, updateSong, updateVoiceBody } from '@bandstand/core';
import type { Song, SongStatus, Voice } from '@bandstand/core';
import { buildRenderModel, formatChordPro, parseChordPro, transposeChordPro } from '@bandstand/chords';
import type { RenderModel } from '@bandstand/chords';
import { Button, Input, Textarea } from '@bandstand/ui';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useBandDoc } from '../hooks/useBandDoc';
import { useYMap } from '../hooks/useYMap';
import { apiClient } from '../lib/api-client';

function TapTempo({ onBpm }: { onBpm: (bpm: number) => void }) {
  const { t } = useTranslation();
  const tapTimesRef = useRef<number[]>([]);

  function handleTap() {
    const now = performance.now();
    const last = tapTimesRef.current.at(-1);
    if (last !== undefined && now - last > 2000) {
      tapTimesRef.current = [];
    }
    tapTimesRef.current.push(now);
    if (tapTimesRef.current.length > 8) tapTimesRef.current.shift();

    if (tapTimesRef.current.length >= 2) {
      const times = tapTimesRef.current;
      const intervals = times.slice(1).map((time, i) => time - times[i]!);
      const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      onBpm(Math.round(60000 / avgMs));
    }
  }

  return (
    <Button type="button" variant="outline" onClick={handleTap}>
      {t('songEditor.tapTempo')}
    </Button>
  );
}

function ChordProPreview({
  body,
  baseKey,
  personalTranspose,
}: {
  body: string;
  baseKey: string;
  personalTranspose: number;
}) {
  const { t } = useTranslation();
  const model: RenderModel | null = useMemo(() => {
    try {
      const parsed = parseChordPro(body);
      // View-only — the actual song/voice being edited never sees this.
      const displayed = personalTranspose !== 0 ? transposeChordPro(parsed, personalTranspose, { key: baseKey }) : parsed;
      return buildRenderModel(displayed);
    } catch {
      return null;
    }
  }, [body, baseKey, personalTranspose]);

  if (!model) {
    return <p className="text-sm text-destructive">{t('songEditor.previewError')}</p>;
  }

  return (
    <div className="font-mono text-sm leading-loose">
      {model.sections.map((section, sectionIndex) => (
        <div key={sectionIndex} className="mb-4">
          {section.lines.map((line, lineIndex) => (
            // A plain block of inline spans, not flex - flex would force
            // each segment's inline-block to blockify (per the flex layout
            // spec), which broke both the chord-above-syllable positioning
            // and the natural inter-word spacing.
            <div key={lineIndex}>
              {line.segments.map((segment, segmentIndex) => (
                <span key={segmentIndex} className="relative inline-block pt-4 align-bottom">
                  {segment.chord && (
                    <span className="absolute left-0 top-0 text-xs font-semibold text-primary">
                      {segment.chord}
                    </span>
                  )}
                  <span className="whitespace-pre">{segment.lyric || ' '}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function SongEditor() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { bandId, songId } = useParams<{ bandId: string; songId?: string }>();
  const { doc } = useBandDoc(bandId ?? null);
  const songs = useYMap<Song>(doc?.getMap('songs'));
  const voices = useYMap<Voice>(doc?.getMap('voices'));

  const isNew = !songId;
  const existingSong = songId ? songs[songId] : undefined;
  const voiceId = songId ? getDefaultVoiceId(songId) : undefined;
  const existingVoice = voiceId ? voices[voiceId] : undefined;

  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [key, setKey] = useState('C');
  const [bpm, setBpm] = useState(120);
  const [durationSec, setDurationSec] = useState(180);
  const [status, setStatus] = useState<SongStatus>('idea');
  const [bandNotes, setBandNotes] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [personalTranspose, setPersonalTranspose] = useState(0);

  useEffect(() => {
    apiClient.getMyPrefs().then((prefs) => setPersonalTranspose(prefs.personalTranspose));
  }, []);

  function handlePersonalTransposeChange(delta: number) {
    const next = personalTranspose + delta;
    setPersonalTranspose(next);
    apiClient.updateMyPrefs({ personalTranspose: next }).catch(() => {
      // Best-effort — the view already reflects `next`; a failed save just
      // means it won't persist for next time, not worth blocking on.
    });
  }

  function handleTransposeSong(delta: number) {
    try {
      const transposed = transposeChordPro(parseChordPro(body), delta, { key });
      setKey(transposed.key ?? key);
      setBody(formatChordPro(transposed));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // One-time load of the existing song/voice into editable local state —
  // deliberately NOT re-synced on every remote Yjs change afterward, so a
  // concurrent edit from another band member doesn't fight this form's
  // cursor while someone is actively typing here.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current || isNew) return;
    if (!existingSong || !existingVoice) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- guarded one-time init from external (Yjs) state, not a per-render sync
    setTitle(existingSong.title);
    setArtist(existingSong.artist);
    setKey(existingSong.key);
    setBpm(existingSong.bpm);
    setDurationSec(existingSong.durationSec);
    setStatus(existingSong.status);
    setBandNotes(existingSong.bandNotes);
    setBody(existingVoice.body);
    initializedRef.current = true;
  }, [isNew, existingSong, existingVoice]);

  if (!bandId) return null;
  if (!isNew && !songId) return <Navigate to={`/bands/${bandId}/repertoire`} replace />;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!doc) return;
    setError(null);
    try {
      if (isNew) {
        addSong(doc, { title, artist, key, bpm, durationSec, status, bandNotes, body });
      } else if (songId && voiceId) {
        updateSong(doc, songId, { title, artist, key, bpm, durationSec, bandNotes });
        setSongStatus(doc, songId, status);
        updateVoiceBody(doc, voiceId, body);
      }
      navigate(`/bands/${bandId}/repertoire`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <Link to={`/bands/${bandId}/repertoire`} className="text-sm text-muted-foreground hover:underline">
        &larr; {t('songEditor.backNew')}
      </Link>

      <h1 className="mt-4 text-xl font-medium">{isNew ? t('songEditor.titleNew') : t('songEditor.titleEdit')}</h1>

      <form onSubmit={handleSubmit} className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="song-title" className="text-sm text-muted-foreground">
                {t('songEditor.title')}
              </label>
              <Input id="song-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label htmlFor="song-artist" className="text-sm text-muted-foreground">
                {t('songEditor.artist')}
              </label>
              <Input id="song-artist" value={artist} onChange={(e) => setArtist(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <label htmlFor="song-key" className="text-sm text-muted-foreground">
                {t('songEditor.key')}
              </label>
              <div className="flex gap-2">
                <Input id="song-key" required value={key} onChange={(e) => setKey(e.target.value)} />
                <Button type="button" variant="outline" size="sm" onClick={() => handleTransposeSong(-1)}>
                  −1
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => handleTransposeSong(1)}>
                  +1
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('songEditor.transposeSongHint')}</p>
            </div>
            <div className="space-y-1">
              <label htmlFor="song-bpm" className="text-sm text-muted-foreground">
                {t('songEditor.bpm')}
              </label>
              <div className="flex gap-2">
                <Input
                  id="song-bpm"
                  type="number"
                  min={1}
                  required
                  value={bpm}
                  onChange={(e) => setBpm(Number(e.target.value))}
                />
                <TapTempo onBpm={setBpm} />
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="song-duration" className="text-sm text-muted-foreground">
                {t('songEditor.duration')}
              </label>
              <Input
                id="song-duration"
                type="number"
                min={0}
                required
                value={durationSec}
                onChange={(e) => setDurationSec(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="song-status" className="text-sm text-muted-foreground">
              {t('songEditor.status')}
            </label>
            <select
              id="song-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as SongStatus)}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="idea">{t('songEditor.statusIdea')}</option>
              <option value="active">{t('songEditor.statusActive')}</option>
              <option value="archived">{t('songEditor.statusArchived')}</option>
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="song-notes" className="text-sm text-muted-foreground">
              {t('songEditor.bandNotes')}
            </label>
            <Textarea id="song-notes" rows={3} value={bandNotes} onChange={(e) => setBandNotes(e.target.value)} />
          </div>

          <div className="space-y-1">
            <label htmlFor="song-body" className="text-sm text-muted-foreground">
              {t('songEditor.chordProBody')}
            </label>
            <Textarea
              id="song-body"
              rows={16}
              className="font-mono"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit">{t('songEditor.save')}</Button>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{t('songEditor.preview')}</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t('songEditor.personalTranspose')}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => handlePersonalTransposeChange(-1)}>
                −1
              </Button>
              <span className="text-xs tabular-nums">{t('songEditor.transposeSemitones', { semitones: personalTranspose })}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => handlePersonalTransposeChange(1)}>
                +1
              </Button>
            </div>
          </div>
          <p className="mb-2 text-xs text-muted-foreground">{t('songEditor.personalTransposeHint')}</p>
          <div className="rounded-md border border-border p-4">
            <ChordProPreview body={body} baseKey={key} personalTranspose={personalTranspose} />
          </div>
        </div>
      </form>
    </main>
  );
}
