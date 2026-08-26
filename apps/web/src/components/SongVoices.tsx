// SPDX-License-Identifier: Apache-2.0
//
// Which voices a song has, and which one each member sees — see
// docs/adr/0008-multi-voice-songs.md. Voice/assignment reads go straight
// through the live Y.Doc (listVoicesForSong/getAssignedVoiceId), not
// useYMap's flat object — the useYMap calls below exist only to subscribe
// this component to re-render on remote changes.
import type { Anchor, BandMember, BandRole } from '@bandstand/core';
import {
  anchorsKey,
  can,
  createVoice,
  getAnchorCalibrationProgress,
  getAssignedVoiceId,
  getAssignment,
  listVoicesForSong,
  setAssignment,
} from '@bandstand/core';
import { buildRenderModel, parseChordPro } from '@bandstand/chords';
import { Button } from '@bandstand/ui';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type * as Y from 'yjs';
import { useYArray } from '../hooks/useYArray';
import { useYMap } from '../hooks/useYMap';
import { apiClient } from '../lib/api-client';
import { authClient } from '../lib/auth-client';
import { UnsupportedFileTypeError, uploadFileToBand } from '../lib/uploadFile';

// Code-split: pdf.js is a large dependency most songs (plain ChordPro)
// never touch, so it shouldn't sit in the app's main bundle.
const PdfVoiceViewer = lazy(() => import('./PdfVoiceViewer').then((m) => ({ default: m.PdfVoiceViewer })));

export function SongVoices({ bandId, songId, doc }: { bandId: string; songId: string; doc: Y.Doc }) {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user.id;

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

    const name = window.prompt(t('songVoices.addVoiceNamePrompt'), file.name.replace(/\.[^.]+$/, ''));
    if (!name) return;

    setUploading(true);
    setUploadError(null);
    try {
      const fileRef = await uploadFileToBand(apiClient, bandId, file);
      createVoice(doc, songId, { name, kind: 'files', files: [fileRef] });
    } catch (err) {
      setUploadError(err instanceof UnsupportedFileTypeError ? t('songVoices.addVoiceUnsupportedType') : t('songVoices.addVoiceFailed'));
    } finally {
      setUploading(false);
    }
  }

  useYMap(doc.getMap('voices'));
  useYMap(doc.getMap('assignments'));
  const anchors = useYArray<Anchor>(doc.getArray(anchorsKey(songId))).sort((a, b) => a.order - b.order);

  const voices = listVoicesForSong(doc, songId);
  const canEditOthers = viewerRole ? can(viewerRole, 'assignment:editOthers') : false;

  if (voices.length === 0) return null;

  return (
    <div className="space-y-4 rounded-md border border-border p-4">
      <div>
        <p className="mb-2 text-sm font-medium">{t('songVoices.voicesTitle')}</p>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {voices.map(({ id, voice }) => {
            const chordProSections =
              voice.kind === 'chordpro' ? buildRenderModel(parseChordPro(voice.body)).sections : undefined;
            const progress =
              anchors.length > 0 ? getAnchorCalibrationProgress(voice, anchors, chordProSections) : null;

            return (
              <li key={id}>
                {voice.kind === 'files' ? (
                  <button
                    type="button"
                    className="w-full rounded-md px-1 py-1 text-left hover:bg-accent/50 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  <span>
                    {voice.name}
                    {voice.instrument ? ` · ${voice.instrument}` : ''} · {t('songVoices.kindChordpro')}
                    {progress && (
                      <span className="ml-2 text-xs">
                        {t('songVoices.anchorProgress', { done: progress.done, total: progress.total })}
                      </span>
                    )}
                  </span>
                )}
                {voice.kind === 'files' && expandedVoiceId === id && (
                  <div className="mt-2 max-w-md">
                    <Suspense fallback={null}>
                      <PdfVoiceViewer bandId={bandId} voiceId={id} voice={voice} doc={doc} />
                    </Suspense>
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
            {uploadError && <p className="mt-1 text-sm text-destructive">{uploadError}</p>}
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">{t('songVoices.assignmentsTitle')}</p>
        <table className="w-full text-sm">
          <tbody>
            {members.map((member) => {
              const isSelf = member.userId === currentUserId;
              const canEdit = isSelf || canEditOthers;
              const assignedVoiceId = getAssignedVoiceId(doc, songId, member.userId, member.instruments);
              const isGuessed = getAssignment(doc, songId, member.userId) === undefined;

              return (
                <tr key={member.userId}>
                  <td className="py-1 pr-4">{member.name}</td>
                  <td className="py-1">
                    {canEdit ? (
                      <select
                        aria-label={t('songVoices.assignmentFor', { name: member.name })}
                        value={assignedVoiceId ?? ''}
                        onChange={(e) => setAssignment(doc, songId, member.userId, e.target.value)}
                        className="h-8 rounded-md border border-border bg-background px-2 text-xs"
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
                    {isGuessed && <span className="ml-2 text-xs text-muted-foreground">{t('songVoices.guessed')}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
