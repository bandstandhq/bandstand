// SPDX-License-Identifier: Apache-2.0
//
// Which voices a song has, and which one each member sees — see
// docs/adr/0008-multi-voice-songs.md. Voice/assignment reads go straight
// through the live Y.Doc (listVoicesForSong/getAssignedVoiceId), not
// useYMap's flat object — the useYMap calls below exist only to subscribe
// this component to re-render on remote changes.
import type { Anchor, BandMember, BandRole, FileRef, Voice } from '@bandstand/core';
import {
  anchorsKey,
  can,
  createVoice,
  getAnchorCalibrationProgress,
  getAssignedVoiceId,
  getAssignment,
  isAllowedFileMimeType,
  listVoicesForSong,
  setAssignment,
  sha256Hex,
} from '@bandstand/core';
import { buildRenderModel, parseChordPro } from '@bandstand/chords';
import { Button, useConfirmDialog } from '@bandstand/ui';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type * as Y from 'yjs';
import { useYArray } from '../hooks/useYArray';
import { useYMap } from '../hooks/useYMap';
import { apiClient } from '../lib/api-client';
import { authClient } from '../lib/auth-client';
import { InsecureContextError, UnsupportedFileTypeError, uploadFileToBand } from '../lib/uploadFile';

// Matches by content (a re-upload of the exact same bytes, maybe re-named)
// or by filename (a corrected re-upload of the same part, re-exported to a
// new hash) — either is the "same document" a re-uploader most likely means
// to overwrite, per the voice files' own {sha256, filename} shape.
function findDuplicateFile(
  voices: Array<{ id: string; voice: Voice }>,
  filename: string,
  sha256: string,
): { voiceId: string; voiceName: string; file: FileRef } | undefined {
  for (const { id, voice } of voices) {
    if (voice.kind !== 'files') continue;
    const file = voice.files.find((f) => f.sha256 === sha256 || f.filename === filename);
    if (file) return { voiceId: id, voiceName: voice.name, file };
  }
  return undefined;
}

// Code-split: pdf.js is a large dependency most songs (plain ChordPro)
// never touch, so it shouldn't sit in the app's main bundle.
const PdfVoiceViewer = lazy(() => import('./PdfVoiceViewer').then((m) => ({ default: m.PdfVoiceViewer })));

export function SongVoices({ bandId, songId, doc }: { bandId: string; songId: string; doc: Y.Doc }) {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user.id;
  const { confirm, chooseAction } = useConfirmDialog();

  const [members, setMembers] = useState<BandMember[]>([]);
  const [viewerRole, setViewerRole] = useState<BandRole | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expandedVoiceId, setExpandedVoiceId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiClient.listBandMembers(bandId).then(setMembers);
    apiClient.listMyBands().then((myBands) => {
      setViewerRole(myBands.find((b) => b.id === bandId)?.role ?? null);
    });
  }, [bandId]);

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    try {
      if (!isAllowedFileMimeType(file.type)) {
        throw new UnsupportedFileTypeError(`Unsupported file type: ${file.type}`);
      }
      if (typeof crypto === 'undefined' || !crypto.subtle) {
        throw new InsecureContextError('crypto.subtle is unavailable outside a secure context.');
      }
      const sha256 = await sha256Hex(await file.arrayBuffer());
      const duplicate = findDuplicateFile(voices, file.name, sha256);

      if (duplicate) {
        const choice = await chooseAction<'overwrite' | 'keepBoth'>({
          title: t('songVoices.duplicateFileTitle', { name: file.name }),
          description: t('songVoices.duplicateFileDescription', { voiceName: duplicate.voiceName }),
          cancelLabel: t('common.cancel'),
          actions: [
            { label: t('songVoices.overwrite'), value: 'overwrite', variant: 'destructive' },
            { label: t('songVoices.keepBoth'), value: 'keepBoth', variant: 'outline' },
          ],
        });
        if (choice === null) return;
        if (choice === 'overwrite') {
          const fileRef = await uploadFileToBand(apiClient, bandId, file);
          await apiClient.overwriteVoiceFile(bandId, songId, duplicate.voiceId, duplicate.file.sha256, fileRef);
          return;
        }
        // 'keepBoth' falls through to the normal new-voice flow below.
      }

      const name = window.prompt(t('songVoices.addVoiceNamePrompt'), file.name.replace(/\.[^.]+$/, ''));
      if (!name) return;
      const fileRef = await uploadFileToBand(apiClient, bandId, file);
      createVoice(doc, songId, { name, kind: 'files', files: [fileRef] });
    } catch (err) {
      setUploadError(
        err instanceof UnsupportedFileTypeError
          ? t('songVoices.addVoiceUnsupportedType')
          : err instanceof InsecureContextError
            ? t('songVoices.addVoiceInsecureContext')
            : t('songVoices.addVoiceFailed'),
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteVoice(voiceId: string, name: string) {
    const confirmed = await confirm({
      title: t('songVoices.deleteVoiceConfirmTitle', { name }),
      description: t('songVoices.deleteVoiceConfirmDescription'),
      confirmLabel: t('songVoices.deleteVoice'),
      cancelLabel: t('common.cancel'),
    });
    if (!confirmed) return;

    try {
      await apiClient.deleteVoice(bandId, songId, voiceId);
    } catch {
      setUploadError(t('songVoices.deleteVoiceFailed'));
    }
  }

  useYMap(doc.getMap('voices'));
  useYMap(doc.getMap('assignments'));
  const anchors = useYArray<Anchor>(doc.getArray(anchorsKey(songId))).sort((a, b) => a.order - b.order);

  const voices = listVoicesForSong(doc, songId);
  const canEditOthers = viewerRole ? can(viewerRole, 'assignment:editOthers') : false;

  // Collapsed by default (whether this is a song you just created or one
  // you've had for years) — its content matters but shouldn't push the
  // fields most edits actually touch further down the page. Previously
  // this whole section rendered nothing at all once a song had no voices,
  // which is exactly how it stayed hidden on the songs a member most
  // needed to find "Add a part" on.
  return (
    <details className="group rounded-md border border-border p-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium marker:hidden [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
          ▸
        </span>
        {t('songVoices.voicesTitle', { count: voices.length })}
      </summary>
      <div className="mt-4 space-y-4">
        <div>
          {voices.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('songVoices.noVoices')}</p>
          )}
          <ul className="space-y-1 text-sm text-muted-foreground">
            {voices.map(({ id, voice }) => {
              const chordProSections =
                voice.kind === 'chordpro' ? buildRenderModel(parseChordPro(voice.body)).sections : undefined;
              const progress =
                anchors.length > 0 ? getAnchorCalibrationProgress(voice, anchors, chordProSections) : null;

              return (
                <li key={id}>
                  <div className="flex items-center gap-1">
                    {voice.kind === 'files' ? (
                      <button
                        type="button"
                        className="flex-1 rounded-md px-1 py-1 text-left hover:bg-accent/50 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setExpandedVoiceId(expandedVoiceId === id ? null : id)}
                      >
                        {voice.name}
                        {voice.instrument ? ` · ${voice.instrument}` : ''} · {t('songVoices.kindFiles')}
                        {progress && (
                          <span className="ml-2 text-xs">
                            {t('songVoices.anchorProgress', { done: progress.done, total: progress.total })}
                          </span>
                        )}
                      </button>
                    ) : (
                      <span className="flex-1">
                        {voice.name}
                        {voice.instrument ? ` · ${voice.instrument}` : ''} · {t('songVoices.kindChordpro')}
                        {progress && (
                          <span className="ml-2 text-xs">
                            {t('songVoices.anchorProgress', { done: progress.done, total: progress.total })}
                          </span>
                        )}
                      </span>
                    )}
                    {viewerRole && can(viewerRole, 'voice:delete') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('songVoices.deleteVoiceAria', { name: voice.name })}
                        onClick={() => handleDeleteVoice(id, voice.name)}
                      >
                        {t('songVoices.deleteVoice')}
                      </Button>
                    )}
                  </div>
                  {voice.kind === 'files' && expandedVoiceId === id && (
                    <div className="mt-2 max-w-md">
                      <Suspense fallback={null}>
                        <PdfVoiceViewer bandId={bandId} voiceId={id} voice={voice} doc={doc} />
                      </Suspense>
                      {/* Personal markup (pen/highlighter/notes) lives in Stage
                          Mode, not here — this preview is for layout/crop/anchor
                          setup, and is too small for a real drawing toolbar. */}
                      <Link
                        to={`/bands/${bandId}/songs/${songId}/play`}
                        className="mt-1 inline-block text-xs text-primary hover:underline"
                      >
                        {t('songVoices.annotateInStageMode')}
                      </Link>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {viewerRole && can(viewerRole, 'file:upload') && (
            <div className="mt-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                className="hidden"
                onChange={handleFileSelected}
              />
              <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                {uploading ? t('songVoices.addVoiceUploading') : t('songVoices.addVoice')}
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">{t('songVoices.addVoiceHint')}</p>
              {uploadError && <p className="mt-1 text-sm text-destructive">{uploadError}</p>}
            </div>
          )}
        </div>

        {voices.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">{t('songVoices.assignmentsTitle')}</p>
            <ul className="space-y-2 text-sm">
              {members.map((member) => {
                const isSelf = member.userId === currentUserId;
                const canEdit = isSelf || canEditOthers;
                const assignedVoiceId = getAssignedVoiceId(doc, songId, member.userId, member.instruments);
                const isGuessed = getAssignment(doc, songId, member.userId) === undefined;

                return (
                  <li key={member.userId} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <span className="wrap-break-word">{member.name}</span>
                    <div className="flex flex-wrap items-center gap-2">
                      {canEdit ? (
                        <select
                          aria-label={t('songVoices.assignmentFor', { name: member.name })}
                          value={assignedVoiceId ?? ''}
                          onChange={(e) => setAssignment(doc, songId, member.userId, e.target.value)}
                          className="h-10 max-w-40 truncate rounded-md border border-border bg-background px-2 text-xs"
                        >
                          {voices.map(({ id, voice }) => (
                            <option key={id} value={id}>
                              {voice.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span>{voices.find((v) => v.id === assignedVoiceId)?.voice.name ?? '—'}</span>
                      )}
                      {isGuessed && <span className="text-xs text-muted-foreground">{t('songVoices.guessed')}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
