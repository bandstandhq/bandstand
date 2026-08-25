// SPDX-License-Identifier: Apache-2.0
import { getDefaultVoiceId, slugify, yDocToSnapshot } from '@bandstand/core';
import { Button } from '@bandstand/ui';
import JSZip from 'jszip';
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

  async function handleExportChordPro() {
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
    const snapshot = yDocToSnapshot(doc);
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'bandstand-export.json');
  }

  return (
    <div className="flex gap-2">
      <Button type="button" variant="outline" onClick={handleExportChordPro}>
        {t('repertoireExport.chordProButton')}
      </Button>
      <Button type="button" variant="outline" onClick={handleExportJSON}>
        {t('repertoireExport.jsonButton')}
      </Button>
    </div>
  );
}
