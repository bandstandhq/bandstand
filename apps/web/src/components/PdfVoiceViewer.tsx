// SPDX-License-Identifier: Apache-2.0
//
// Renders a `files`-kind voice — a scanned PDF/image part — entirely
// client-side (never server-rendered, see docs/adr/0008-multi-voice-songs.md
// and the A3 plan). Multiple files on one voice are one continuous page
// sequence, so this flattens them into a single page list before display.
import type { FileRef, Voice } from '@bandstand/core';
import { Button } from '@bandstand/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../lib/api-client';
import { pdfjsLib } from '../lib/pdfjs';

type FilesVoice = Extract<Voice, { kind: 'files' }>;
type DisplayMode = 'single' | 'spread' | 'scroll';

interface FlatPage {
  key: string;
  file: FileRef;
  /** 1-based page number within `file` — pdf.js pages are 1-based. */
  pageNumber: number;
}

function flattenPages(files: FileRef[]): FlatPage[] {
  const pages: FlatPage[] = [];
  for (const file of files) {
    for (let pageNumber = 1; pageNumber <= file.pageCount; pageNumber++) {
      pages.push({ key: `${file.sha256}:${pageNumber}`, file, pageNumber });
    }
  }
  return pages;
}

/** One per sha256 — a PDF's pages all come from the same loaded document. */
function usePdfDocuments(bandId: string, files: FileRef[]) {
  const [docs, setDocs] = useState<Map<string, import('pdfjs-dist').PDFDocumentProxy>>(new Map());
  const [imageUrls, setImageUrls] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    // `destroy()` lives on the loading task, not the resolved document proxy.
    const loadingTasks: import('pdfjs-dist').PDFDocumentLoadingTask[] = [];

    async function loadAll() {
      const uniqueFiles = [...new Map(files.map((f) => [f.sha256, f])).values()];
      for (const file of uniqueFiles) {
        const { downloadUrl } = await apiClient.presignFileDownload(bandId, file.sha256);
        if (cancelled) return;
        if (file.mime === 'application/pdf') {
          const loadingTask = pdfjsLib.getDocument({ url: downloadUrl });
          loadingTasks.push(loadingTask);
          const doc = await loadingTask.promise;
          if (cancelled) return;
          setDocs((prev) => new Map(prev).set(file.sha256, doc));
        } else {
          setImageUrls((prev) => new Map(prev).set(file.sha256, downloadUrl));
        }
      }
    }

    void loadAll();
    return () => {
      cancelled = true;
      for (const task of loadingTasks) void task.destroy();
    };
    // `files` is a fresh array from listVoicesForSong on every Yjs change —
    // re-run only when the actual file set (by hash) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandId, files.map((f) => f.sha256).join(',')]);

  return { docs, imageUrls };
}

/** Renders one PDF page into a fresh canvas, tagged for the A3.1 performance measurement. */
async function renderPdfPage(doc: import('pdfjs-dist').PDFDocumentProxy, pageNumber: number, targetWidth: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber);
  const unscaledViewport = page.getViewport({ scale: 1 });
  const scale = (targetWidth / unscaledViewport.width) * Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = '100%';
  canvas.style.height = 'auto';

  const markStart = `pdf-render-start-${pageNumber}-${Date.now()}`;
  performance.mark(markStart);
  await page.render({ canvas, viewport }).promise;
  performance.measure('pdf-page-render', markStart);

  return canvas;
}

function PageView({
  page,
  doc,
  imageUrl,
  containerWidth,
}: {
  page: FlatPage;
  doc: import('pdfjs-dist').PDFDocumentProxy | undefined;
  imageUrl: string | undefined;
  containerWidth: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!doc || !containerRef.current) return;
    let cancelled = false;
    renderPdfPage(doc, page.pageNumber, containerWidth).then((canvas) => {
      if (cancelled || !containerRef.current) return;
      containerRef.current.replaceChildren(canvas);
    });
    return () => {
      cancelled = true;
    };
  }, [doc, page.pageNumber, containerWidth]);

  if (imageUrl) {
    return <img src={imageUrl} alt="" className="w-full" style={{ width: containerWidth }} />;
  }
  return <div ref={containerRef} className="min-h-40 bg-muted" style={{ width: containerWidth }} />;
}

export function PdfVoiceViewer({ bandId, voice }: { bandId: string; voice: FilesVoice }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<DisplayMode>('single');
  const [pageIndex, setPageIndex] = useState(0);
  const [containerWidth, setContainerWidth] = useState(800);
  const containerRef = useRef<HTMLDivElement>(null);

  const pages = useMemo(() => flattenPages(voice.files), [voice.files]);
  const { docs, imageUrls } = usePdfDocuments(bandId, voice.files);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Current page is what's on screen; neighbors are pre-rendered into the
  // pdf.js page cache in the background so a page turn doesn't wait on a
  // fresh render — getPage() itself is cached by pdf.js per document, so
  // calling it here (without awaiting) is enough to warm that cache.
  useEffect(() => {
    const idle = 'requestIdleCallback' in window ? window.requestIdleCallback : (fn: () => void) => setTimeout(fn, 0);
    idle(() => {
      for (const neighborIndex of [pageIndex - 1, pageIndex + 1]) {
        const neighbor = pages[neighborIndex];
        const doc = neighbor && docs.get(neighbor.file.sha256);
        if (doc) void doc.getPage(neighbor.pageNumber);
      }
    });
  }, [pageIndex, pages, docs]);

  if (pages.length === 0) return null;

  const clampedIndex = Math.max(0, Math.min(pageIndex, pages.length - 1));
  const visiblePages = mode === 'spread' ? [pages[clampedIndex], pages[clampedIndex + 1]].filter((p): p is FlatPage => !!p) : [pages[clampedIndex]!];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          <Button variant={mode === 'single' ? 'default' : 'outline'} size="sm" onClick={() => setMode('single')}>
            {t('pdfViewer.modeSingle')}
          </Button>
          <Button variant={mode === 'spread' ? 'default' : 'outline'} size="sm" onClick={() => setMode('spread')}>
            {t('pdfViewer.modeSpread')}
          </Button>
          <Button variant={mode === 'scroll' ? 'default' : 'outline'} size="sm" onClick={() => setMode('scroll')}>
            {t('pdfViewer.modeScroll')}
          </Button>
        </div>
        {mode !== 'scroll' && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={clampedIndex === 0} onClick={() => setPageIndex(clampedIndex - 1)}>
              {t('pdfViewer.prevPage')}
            </Button>
            <span className="text-sm text-muted-foreground">
              {t('pdfViewer.pageOf', { current: clampedIndex + 1, total: pages.length })}
            </span>
            <Button variant="outline" size="sm" disabled={clampedIndex >= pages.length - 1} onClick={() => setPageIndex(clampedIndex + 1)}>
              {t('pdfViewer.nextPage')}
            </Button>
          </div>
        )}
      </div>

      <div ref={containerRef} className="w-full">
        {mode === 'scroll' ? (
          <div className="space-y-4">
            {pages.map((page) => (
              <PageView
                key={page.key}
                page={page}
                doc={docs.get(page.file.sha256)}
                imageUrl={imageUrls.get(page.file.sha256)}
                containerWidth={containerWidth}
              />
            ))}
          </div>
        ) : (
          <div className={mode === 'spread' ? 'flex gap-2' : ''}>
            {visiblePages.map((page) => (
              <PageView
                key={page.key}
                page={page}
                doc={docs.get(page.file.sha256)}
                imageUrl={imageUrls.get(page.file.sha256)}
                containerWidth={mode === 'spread' ? containerWidth / 2 - 4 : containerWidth}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
