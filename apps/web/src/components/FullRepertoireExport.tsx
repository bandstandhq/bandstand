// SPDX-License-Identifier: Apache-2.0
//
// The full repertoire, bundled as one ZIP: every song's ChordPro text, the
// complete snapshot as JSON, and every uploaded file attachment (scanned
// parts, PDFs) — unlike Repertoire.tsx's own ExportRepertoire, which only
// covers ChordPro/JSON and is open to every member. This one additionally
// bundles attachments, which means fetching each one's bytes over the
// network (via the same presigned-download flow PdfVoiceViewer.tsx uses),
// so it's a heavier, deliberate action rather than an instant download —
// gated to owner/admin (`repertoire:export`, a UI-level convenience gate;
// see docs/PERMISSIONS.md's footnote).
import { getDefaultVoiceId, slugify, yDocToSnapshot } from '@bandstand/core';
import { Button } from '@bandstand/ui';
import JSZip from 'jszip';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type * as Y from 'yjs';
import { apiClient } from '../lib/api-client';

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function FullRepertoireExport({ bandId, doc }: { bandId: string; doc: Y.Doc }) {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const snapshot = yDocToSnapshot(doc);
      const zip = new JSZip();
      zip.file('bandstand-export.json', JSON.stringify(snapshot, null, 2));

      const chordProFolder = zip.folder('chordpro')!;
      for (const [songId, song] of Object.entries(snapshot.songs)) {
        const voice = snapshot.voices[getDefaultVoiceId(songId)];
        if (voice?.kind === 'chordpro') {
          chordProFolder.file(`${slugify(song.title) || songId}.cho`, voice.body);
        }
      }

      const filesFolder = zip.folder('files')!;
      // The same file can appear in more than one voice (or even the same
      // voice twice) — fetched once regardless, keyed by sha256.
      const blobsByHash = new Map<string, Blob>();
      for (const voice of Object.values(snapshot.voices)) {
        if (voice.kind !== 'files') continue;
        const song = snapshot.songs[voice.songId];
        const songFolder = filesFolder.folder(slugify(song?.title ?? voice.songId) || voice.songId)!;
        const voiceFolder = songFolder.folder(slugify(voice.name) || 'voice')!;
        for (const file of voice.files) {
          let blob = blobsByHash.get(file.sha256);
          if (!blob) {
            const { downloadUrl } = await apiClient.presignFileDownload(bandId, file.sha256);
            const res = await fetch(downloadUrl);
            // A reference to a file that's since gone missing shouldn't
            // fail the whole export — skip it and move on.
            if (!res.ok) continue;
            blob = await res.blob();
            blobsByHash.set(file.sha256, blob);
          }
          voiceFolder.file(file.filename, blob);
        }
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, 'bandstand-repertoire-export.zip');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <Button type="button" variant="outline" onClick={() => void handleExport()} disabled={exporting}>
        {exporting ? t('repertoireExport.fullExportInProgress') : t('repertoireExport.fullExportButton')}
      </Button>
      {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
    </div>
  );
}
