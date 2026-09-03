// SPDX-License-Identifier: Apache-2.0
import { getDefaultVoiceId, slugify, yDocToSnapshot } from '@bandstand/core';
import JSZip from 'jszip';
import { Upload } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type * as Y from 'yjs';

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** Client-side only, per the brief — no server round-trip for either format. */
export function ExportRepertoire({ doc }: { doc: Y.Doc }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  async function handleExportChordPro() {
    setOpen(false);
    const snapshot = yDocToSnapshot(doc);
    const zip = new JSZip();
    for (const [songId, song] of Object.entries(snapshot.songs)) {
      const voice = snapshot.voices[getDefaultVoiceId(songId)];
      const fileName = `${slugify(song.title) || songId}.cho`;
      zip.file(fileName, voice?.kind === 'chordpro' ? voice.body : '');
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, 'bandstand-chordpro-export.zip');
  }

  function handleExportJSON() {
    setOpen(false);
    const snapshot = yDocToSnapshot(doc);
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'bandstand-export.json');
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={t('repertoireExport.exportButton')}
        title={t('repertoireExport.exportButton')}
        aria-expanded={open}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent"
      >
        <Upload className="h-5 w-5" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 min-w-max rounded-md border border-border bg-card p-1 shadow-md">
          <button
            type="button"
            onClick={handleExportChordPro}
            className="block w-full whitespace-nowrap rounded px-3 py-2 text-left text-sm hover:bg-accent"
          >
            {t('repertoireExport.chordProButton')}
          </button>
          <button
            type="button"
            onClick={handleExportJSON}
            className="block w-full whitespace-nowrap rounded px-3 py-2 text-left text-sm hover:bg-accent"
          >
            {t('repertoireExport.jsonButton')}
          </button>
        </div>
      )}
    </div>
  );
}
