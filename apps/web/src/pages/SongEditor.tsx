// SPDX-License-Identifier: Apache-2.0
import { addSong, getDefaultVoiceId, setSongStatus, updateSong, updateVoiceBody, voiceSchema } from '@bandstand/core';
import type { Song, SongStatus } from '@bandstand/core';
import {
  buildRenderModel,
  formatChordPro,
  isMinorKeyName,
  normalizeKey,
  parseChordPro,
  shiftKeyBySemitones,
  STANDARD_KEYS,
  transposeChordProToKey,
} from '@bandstand/chords';
import type { RenderModel } from '@bandstand/chords';
import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@bandstand/ui';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { PageShell } from '../components/PageShell';
import { BandAccessDenied } from '../components/BandAccessDenied';
import { SongAnchors } from '../components/SongAnchors';
import { SongVoices } from '../components/SongVoices';
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog';
import { useBandDoc } from '../hooks/useBandDoc';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
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

// The 15 standard key letters (packages/chords' STANDARD_KEYS, major
// names only — minor keys share the same 15 letters, just with an 'm'
// suffix), chromatic order, with an enharmonic pair's alternate spelling
// immediately after its standard one (F# then Gb, C# then Db).
const KEY_LETTER_OPTIONS: string[] = STANDARD_KEYS.filter((k) => k.mode === 'major')
  .slice()
  .sort((a, b) => a.semitone - b.semitone || Number(b.standard) - Number(a.standard))
  .map((k) => k.name);

/** Marks a field as always-required — shown before any failed attempt, not just after one. */
function RequiredMark({ t }: { t: (key: string) => string }) {
  return (
    <span className="text-destructive" aria-label={t('songEditor.required')}>
      {' '}
      *
    </span>
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
      // personalTranspose is an interval, not a target key — it still
      // resolves to one (a single semitone offset from baseKey) so the
      // spelling follows *that* key, not baseKey's.
      const displayed =
        personalTranspose !== 0
          ? transposeChordProToKey(parsed, baseKey, shiftKeyBySemitones(baseKey, personalTranspose))
          : parsed;
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

interface SongEditorValues {
  title: string;
  artist: string;
  key: string;
  bpm: number;
  durationSec: number;
  status: SongStatus;
  bandNotes: string;
  body: string;
}

const SONG_EDITOR_DEFAULTS: SongEditorValues = {
  title: '',
  artist: '',
  key: 'C',
  bpm: 120,
  durationSec: 180,
  status: 'idea',
  bandNotes: '',
  body: '',
};

export function SongEditor() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { bandId, songId } = useParams<{ bandId: string; songId?: string }>();
  const { doc, status: docStatus } = useBandDoc(bandId ?? null);
  const songs = useYMap<Song>(doc?.getMap('songs'));
  // useYMap returns raw Yjs values, not run through voiceSchema — so a
  // voice stored before Milestone 2 (no `kind` field at all) needs the
  // schema's own back-compat parse here, same as the server already does
  // in getVoice/listVoicesForSong, or it won't be recognized as chordpro.
  const rawVoices = useYMap<unknown>(doc?.getMap('voices'));

  const isNew = !songId;
  const existingSong = songId ? songs[songId] : undefined;
  const voiceId = songId ? getDefaultVoiceId(songId) : undefined;
  const rawExistingVoice = voiceId ? rawVoices[voiceId] : undefined;
  const existingVoice = rawExistingVoice ? voiceSchema.parse(rawExistingVoice) : undefined;

  const form = useForm<SongEditorValues>({ defaultValues: SONG_EDITOR_DEFAULTS });
  const key = useWatch({ control: form.control, name: 'key' });
  const body = useWatch({ control: form.control, name: 'body' });
  const durationSecValue = useWatch({ control: form.control, name: 'durationSec' });
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

  // The key/body this editing session started from — every transpose
  // action (the letter/mode selects, the ±1 buttons) re-transposes from
  // here in one step, never from whatever the previous transpose left in
  // `key`/`body`. That's what makes every target key reachable regardless
  // of how many transpose actions came before it in this session.
  const originalKeyRef = useRef('C');
  const originalBodyRef = useRef('');

  function applyTargetKey(newKey: string) {
    setError(null);
    try {
      const transposed = transposeChordProToKey(parseChordPro(originalBodyRef.current), originalKeyRef.current, newKey);
      form.setValue('key', newKey, { shouldDirty: true });
      form.setValue('body', formatChordPro(transposed), { shouldDirty: true });
    } catch {
      setError(t('songEditor.transposeError'));
    }
  }

  // One-time load of the existing song/voice into the form — deliberately
  // NOT re-synced on every remote Yjs change afterward, so a concurrent
  // edit from another band member doesn't fight this form's cursor while
  // someone is actively typing here. The stored key is normalized here
  // (and so written back correctly on the next save) in case it predates
  // this app version ever offering only the standard 15 keys as transpose
  // targets. form.reset() both loads the values AND resets the dirty-
  // comparison baseline to them in one call, replacing the separate
  // initialSnapshot state the pre-react-hook-form version needed.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current || isNew) return;
    // The ChordPro form below only applies to a chordpro-kind voice — a
    // files-kind default voice gets its own editor in a later Milestone 2
    // step, not this form.
    if (!existingSong || !existingVoice || existingVoice.kind !== 'chordpro') return;
    const normalizedKey = normalizeKey(existingSong.key);
    form.reset({
      title: existingSong.title,
      artist: existingSong.artist,
      key: normalizedKey,
      bpm: existingSong.bpm,
      durationSec: existingSong.durationSec,
      status: existingSong.status,
      bandNotes: existingSong.bandNotes,
      body: existingVoice.body,
    });
    originalKeyRef.current = normalizedKey;
    originalBodyRef.current = existingVoice.body;
    initializedRef.current = true;
  }, [isNew, existingSong, existingVoice, form]);

  const unsavedGuard = useUnsavedChangesGuard(form.formState.isDirty);

  if (!bandId) return null;
  if (docStatus === 'forbidden') return <BandAccessDenied />;
  if (!isNew && !songId) return <Navigate to={`/bands/${bandId}/repertoire`} replace />;

  const keyIsMinor = isMinorKeyName(key);
  const keyLetter = keyIsMinor ? key.slice(0, -1) : key;

  function handleKeyLetterChange(letter: string) {
    applyTargetKey(keyIsMinor ? `${letter}m` : letter);
  }

  function handleKeyModeChange(minor: boolean) {
    applyTargetKey(minor ? `${keyLetter}m` : keyLetter);
  }

  // Only title/artist can actually fail validation now — every other field
  // either comes from a select (always a valid option) or is sanitized to a
  // safe fallback below, so it can never be the reason a save is rejected.
  // Checked in the same top-to-bottom order they appear in the form, so
  // "the topmost missing field" falls out of just checking title first.
  // Deliberately doesn't navigate itself — the unsaved-changes dialog's own
  // Save button needs to go wherever the user was originally headed, not
  // to this form's own normal post-save destination (handleSubmit, below,
  // is what wants that one).
  function trySave(): { ok: boolean; newSongId?: string } {
    if (!doc) return { ok: false };
    setError(null);
    const { title, artist, key: currentKey, bpm, durationSec, status, bandNotes, body: currentBody } = form.getValues();
    if (!title.trim()) {
      setError(t('songEditor.errorTitleRequired'));
      form.setFocus('title');
      return { ok: false };
    }
    if (!artist.trim()) {
      setError(t('songEditor.errorArtistRequired'));
      form.setFocus('artist');
      return { ok: false };
    }
    // A mobile number input can hand back an empty string (parses to 0) or
    // NaN for reasons that have nothing to do with what the user actually
    // filled in (e.g. an in-progress edit read mid-keystroke) — falling
    // back to the field's own pre-filled default rather than rejecting the
    // whole save is what makes these fields genuinely optional in practice.
    // A wildly out-of-range BPM (e.g. a stray extra digit) is clamped to the
    // nearest valid tempo rather than reset to the default — a mistyped 500
    // landing on 400 is a much smaller surprise than it silently becoming 120.
    const safeBpm = Number.isFinite(bpm) ? Math.min(400, Math.max(20, Math.round(bpm))) : 120;
    const safeDurationSec = Number.isFinite(durationSec) && durationSec >= 0 ? Math.round(durationSec) : 180;
    try {
      if (isNew) {
        const newSongId = addSong(doc, {
          title: title.trim(),
          artist: artist.trim(),
          key: currentKey,
          bpm: safeBpm,
          durationSec: safeDurationSec,
          status,
          bandNotes,
          body: currentBody,
        });
        return { ok: true, newSongId };
      } else if (songId && voiceId) {
        updateSong(doc, songId, {
          title: title.trim(),
          artist: artist.trim(),
          key: currentKey,
          bpm: safeBpm,
          durationSec: safeDurationSec,
          bandNotes,
        });
        setSongStatus(doc, songId, status);
        // `body` is only ever populated for a chordpro-kind default voice
        // (see the init effect above, which bails out for any other kind)
        // — calling this unconditionally for a `files` voice happened to be
        // harmless only because voiceSchema's discriminated union silently
        // strips the stray `body` field, an implementation detail this
        // shouldn't depend on. Every save of a song whose default voice is
        // a PDF wrote a pointless extra Yjs update for nothing.
        if (existingVoice?.kind === 'chordpro') updateVoiceBody(doc, voiceId, currentBody);
        return { ok: true };
      }
      return { ok: false };
    } catch {
      setError(t('songEditor.saveError'));
      return { ok: false };
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const result = trySave();
    if (!result.ok) return;
    // Straight into editing the song just created, not back to the list —
    // that's the only way to reach the Voices section below (it needs a
    // real songId to attach a file to), and landing there immediately is
    // what makes "add a Full Score" discoverable right after creating a
    // song instead of a separate, unguided step.
    if (isNew && result.newSongId) navigate(`/bands/${bandId}/songs/${result.newSongId}/edit`);
    else navigate(`/bands/${bandId}/repertoire`);
  }

  function handleSaveFromUnsavedDialog() {
    if (trySave().ok) unsavedGuard.leave();
  }

  return (
    <PageShell title={isNew ? t('songEditor.titleNew') : t('songEditor.titleEdit')}>
      <UnsavedChangesDialog
        open={unsavedGuard.pending !== null}
        onSave={handleSaveFromUnsavedDialog}
        onDiscard={unsavedGuard.leave}
        onContinueEditing={unsavedGuard.continueEditing}
      />
      <Link to={`/bands/${bandId}/repertoire`} className="mt-4 inline-block text-sm text-muted-foreground hover:underline">
        &larr; {t('songEditor.backNew')}
      </Link>

      {!isNew && songId && doc && (
        <div className="mt-4 space-y-4">
          <SongVoices bandId={bandId} songId={songId} doc={doc} />
          <SongAnchors bandId={bandId} songId={songId} doc={doc} />
        </div>
      )}

      {/* noValidate: the numeric fields' min/max are a spinner/screen-reader
          hint, not a hard gate — native constraint validation would silently
          block the submit event (no error, no save) for e.g. a BPM over 400
          instead of letting handleSubmit's own clamp fix it up. */}
      <Form {...form}>
        <form onSubmit={handleSubmit} noValidate className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <label htmlFor="song-title" className="text-sm text-muted-foreground">
                      {t('songEditor.title')}
                      <RequiredMark t={t} />
                    </label>
                    <FormControl>
                      <Input id="song-title" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="artist"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <label htmlFor="song-artist" className="text-sm text-muted-foreground">
                      {t('songEditor.artist')}
                      <RequiredMark t={t} />
                    </label>
                    <FormControl>
                      <Input id="song-artist" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="song-key" className="text-sm text-muted-foreground">
                {t('songEditor.key')}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={keyLetter} onValueChange={handleKeyLetterChange}>
                  <SelectTrigger id="song-key" className="w-auto">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KEY_LETTER_OPTIONS.map((letter) => (
                      <SelectItem key={letter} value={letter}>
                        {letter}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={keyIsMinor ? 'minor' : 'major'}
                  onValueChange={(value) => handleKeyModeChange(value === 'minor')}
                >
                  <SelectTrigger aria-label={t('songEditor.keyMode')} className="w-auto">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="major">{t('songEditor.keyModeMajor')}</SelectItem>
                    <SelectItem value="minor">{t('songEditor.keyModeMinor')}</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => applyTargetKey(shiftKeyBySemitones(key, -1))}
                  >
                    −1
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => applyTargetKey(shiftKeyBySemitones(key, 1))}
                  >
                    +1
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t('songEditor.transposeSongHint')}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label htmlFor="song-bpm" className="text-sm text-muted-foreground">
                  {t('songEditor.bpm')}
                </label>
                <div className="flex gap-2">
                  <FormField
                    control={form.control}
                    name="bpm"
                    render={({ field }) => (
                      <FormItem className="contents">
                        <FormControl>
                          <Input
                            id="song-bpm"
                            type="number"
                            inputMode="numeric"
                            min={20}
                            max={400}
                            step={1}
                            value={field.value}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            name={field.name}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <TapTempo onBpm={(newBpm) => form.setValue('bpm', newBpm, { shouldDirty: true })} />
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground">{t('songEditor.duration')}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    aria-label={t('songEditor.durationMinutes')}
                    value={Math.floor(durationSecValue / 60)}
                    onChange={(e) => {
                      const minutes = Math.max(0, Math.round(Number(e.target.value) || 0));
                      form.setValue('durationSec', minutes * 60 + (durationSecValue % 60), { shouldDirty: true });
                    }}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">{t('songEditor.durationMinutesShort')}</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={59}
                    step={1}
                    aria-label={t('songEditor.durationSeconds')}
                    value={durationSecValue % 60}
                    onChange={(e) => {
                      const seconds = Math.max(0, Math.min(59, Math.round(Number(e.target.value) || 0)));
                      form.setValue('durationSec', Math.floor(durationSecValue / 60) * 60 + seconds, {
                        shouldDirty: true,
                      });
                    }}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">{t('songEditor.durationSecondsShort')}</span>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="song-status" className="text-sm text-muted-foreground">
                {t('songEditor.status')}
              </label>
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem className="contents">
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="song-status" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="idea">{t('songEditor.statusIdea')}</SelectItem>
                        <SelectItem value="active">{t('songEditor.statusActive')}</SelectItem>
                        <SelectItem value="archived">{t('songEditor.statusArchived')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="bandNotes"
              render={({ field }) => (
                <FormItem className="space-y-1">
                  <label htmlFor="song-notes" className="text-sm text-muted-foreground">
                    {t('songEditor.bandNotes')}
                  </label>
                  <FormControl>
                    <Textarea id="song-notes" rows={3} {...field} />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="body"
              render={({ field }) => (
                <FormItem className="space-y-1">
                  <label htmlFor="song-body" className="text-sm text-muted-foreground">
                    {t('songEditor.chordProBody')}
                  </label>
                  <FormControl>
                    <Textarea id="song-body" rows={16} className="font-mono" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />

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
      </Form>
    </PageShell>
  );
}
