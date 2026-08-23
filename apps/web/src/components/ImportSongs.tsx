// SPDX-License-Identifier: Apache-2.0
import { addSong } from '@bandstand/core';
import { buildRenderModel, parseChordPro } from '@bandstand/chords';
import { Button } from '@bandstand/ui';
import { type DragEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type * as Y from 'yjs';

interface ParsedImport {
  id: string;
  fileName: string;
  title: string;
  artist: string;
  key: string;
  body: string;
  error: boolean;
}

const DEFAULT_IMPORTED_BPM = 120;
const DEFAULT_IMPORTED_DURATION_SEC = 180;

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^./]+$/, '');
}

async function parseFile(file: File): Promise<ParsedImport> {
  const text = await file.text();
  try {
    const model = buildRenderModel(parseChordPro(text));
    return {
      id: crypto.randomUUID(),
      fileName: file.name,
      title: model.title ?? stripExtension(file.name),
      artist: model.artist ?? '',
      key: model.key ?? 'C',
      body: text,
      error: false,
    };
  } catch {
    return {
      id: crypto.randomUUID(),
      fileName: file.name,
      title: stripExtension(file.name),
      artist: '',
      key: 'C',
      body: text,
      error: true,
    };
  }
}

export function ImportSongs({ doc, onImported }: { doc: Y.Doc; onImported: (count: number) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [parsed, setParsed] = useState<ParsedImport[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const results = await Promise.all(Array.from(files).map(parseFile));
    setParsed((prev) => [...prev, ...results]);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    handleFiles(event.dataTransfer.files);
  }

  function removeParsed(id: string) {
    setParsed((prev) => prev.filter((p) => p.id !== id));
  }

  function handleImport() {
    const toImport = parsed.filter((p) => !p.error);
    for (const item of toImport) {
      addSong(doc, {
        title: item.title,
        artist: item.artist,
        key: item.key,
        bpm: DEFAULT_IMPORTED_BPM,
        durationSec: DEFAULT_IMPORTED_DURATION_SEC,
        status: 'idea',
        body: item.body,
      });
    }
    onImported(toImport.length);
    setParsed([]);
    setOpen(false);
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t('chordProImport.openButton')}
      </Button>
    );
  }

  return (
    <div className="rounded-md border border-border p-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex items-center justify-center gap-1 rounded-md border-2 border-dashed p-6 text-sm text-muted-foreground ${
          dragOver ? 'border-primary' : 'border-border'
        }`}
      >
        <span>{t('chordProImport.dropHint')}</span>
        <button type="button" className="text-primary hover:underline" onClick={() => fileInputRef.current?.click()}>
          {t('chordProImport.browse')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".cho,.chopro,.crd,.pro,.txt"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {parsed.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-sm text-muted-foreground">{t('chordProImport.previewTitle')}</p>
          <ul className="space-y-2">
            {parsed.map((item) => (
              <li key={item.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                <div>
                  <p className="font-medium">
                    {item.title} {item.artist && `— ${item.artist}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.fileName} ({item.key})
                    {item.error && <span className="ml-2 text-destructive">{t('chordProImport.parseError')}</span>}
                  </p>
                </div>
                <button type="button" onClick={() => removeParsed(item.id)} className="text-xs text-muted-foreground hover:underline">
                  {t('chordProImport.remove')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <Button
          type="button"
          disabled={parsed.filter((p) => !p.error).length === 0}
          onClick={handleImport}
        >
          {t('chordProImport.import', { count: parsed.filter((p) => !p.error).length })}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setParsed([]);
            setOpen(false);
          }}
        >
          {t('chordProImport.cancel')}
        </Button>
      </div>
    </div>
  );
}
