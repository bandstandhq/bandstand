// SPDX-License-Identifier: Apache-2.0
//
// Renders a `files`-kind voice — a scanned PDF/image part — entirely
// client-side (never server-rendered). Display customization (crop/rotate/
// reorder/duplicate) is a "recipe" applied at render time, never a file
// edit — see docs/adr/0009-voice-display-recipe.md.
import type { Anchor, CropMargins, DisplayRecipe, Voice, VoiceAnchorPosition } from '@bandstand/core';
import { anchorsKey, resolveDisplaySequence, setVoiceAnchorPosition, setVoiceDisplayRecipe } from '@bandstand/core';
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@bandstand/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type * as Y from 'yjs';
import { useYArray } from '../hooks/useYArray';
import { apiClient } from '../lib/api-client';
import { ensureCached, getCachedBlob } from '../lib/blobCache';
import { pdfjsLib } from '../lib/pdfjs';

type FilesVoice = Extract<Voice, { kind: 'files' }>;
type DisplayMode = 'single' | 'spread' | 'scroll';
type Rotation = 0 | 90 | 180 | 270;
type PdfDoc = import('pdfjs-dist').PDFDocumentProxy;

const NO_CROP: CropMargins = { top: 0, right: 0, bottom: 0, left: 0 };
const ROTATION_STEP: Record<Rotation, Rotation> = { 0: 90, 90: 180, 180: 270, 270: 0 };
const CROP_FIELDS = ['top', 'right', 'bottom', 'left'] as const;

function cropCanvas(source: HTMLCanvasElement, crop: CropMargins): HTMLCanvasElement {
  const sx = Math.round(crop.left * source.width);
  const sy = Math.round(crop.top * source.height);
  const sw = Math.max(1, Math.round(source.width * (1 - crop.left - crop.right)));
  const sh = Math.max(1, Math.round(source.height * (1 - crop.top - crop.bottom)));
  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  out.getContext('2d')!.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

/**
 * A tap during anchor calibration lands in *display* space — cropped, and
 * rotated the way the page is currently shown — but an anchorMap entry's
 * `yPct` must always mean "how far down the page in its original, unrotated
 * orientation" (see docs/adr/0010-anchor-sync.md and schemas/voice.ts), so a
 * 90°-rotated page's on-screen Y is actually the source page's X. This
 * undoes both transforms, in that order: first the crop (recovering a
 * fraction of the *full*, uncropped-but-rotated page), then the rotation.
 */
function displayPointToSourceYPct(
  rotation: Rotation,
  crop: CropMargins | undefined,
  xFracDisplay: number,
  yFracDisplay: number,
): number {
  const c = crop ?? NO_CROP;
  const xFracRotated = c.left + xFracDisplay * (1 - c.left - c.right);
  const yFracRotated = c.top + yFracDisplay * (1 - c.top - c.bottom);

  switch (rotation) {
    case 0:
      return yFracRotated;
    case 180:
      return 1 - yFracRotated;
    case 90:
      return 1 - xFracRotated;
    case 270:
      return xFracRotated;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // avoids tainting the canvas it's drawn into — MinIO's CORS already allows this origin (A1.2)
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/** A cache hit never needs the network at all; a miss falls back to a presigned download (and caches it for next time). */
async function loadFileBlob(bandId: string, sha256: string): Promise<Blob> {
  const cached = await getCachedBlob(sha256);
  if (cached) return cached;

  await ensureCached(sha256, async () => {
    const { downloadUrl } = await apiClient.presignFileDownload(bandId, sha256);
    return downloadUrl;
  });
  const blob = await getCachedBlob(sha256);
  if (!blob) throw new Error(`Blob ${sha256} missing from cache immediately after caching it`);
  return blob;
}

/** One per sha256 — a PDF's pages all come from the same loaded document. Falls back to the offline blob cache (A4) when the network is unavailable. */
function usePdfDocuments(bandId: string, files: FilesVoice['files']) {
  const [docs, setDocs] = useState<Map<string, PdfDoc>>(new Map());
  const [imageUrls, setImageUrls] = useState<Map<string, string>>(new Map());
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    // `destroy()` lives on the loading task, not the resolved document proxy.
    const loadingTasks: import('pdfjs-dist').PDFDocumentLoadingTask[] = [];
    const objectUrls: string[] = [];

    async function loadAll() {
      const uniqueFiles = [...new Map(files.map((f) => [f.sha256, f])).values()];
      for (const file of uniqueFiles) {
        let blob: Blob;
        try {
          blob = await loadFileBlob(bandId, file.sha256);
        } catch {
          // Offline and never pre-loaded (A4's pre-load pass, or a previous
          // view, would have cached it otherwise) — a clear "not available"
          // state beats an indefinite spinner.
          if (!cancelled) setUnavailable((prev) => new Set(prev).add(file.sha256));
          continue;
        }
        if (cancelled) return;

        if (file.mime === 'application/pdf') {
          const loadingTask = pdfjsLib.getDocument({ data: await blob.arrayBuffer() });
          loadingTasks.push(loadingTask);
          const doc = await loadingTask.promise;
          if (cancelled) return;
          setDocs((prev) => new Map(prev).set(file.sha256, doc));
        } else {
          const objectUrl = URL.createObjectURL(blob);
          objectUrls.push(objectUrl);
          setImageUrls((prev) => new Map(prev).set(file.sha256, objectUrl));
        }
      }
    }

    void loadAll();
    return () => {
      cancelled = true;
      for (const task of loadingTasks) void task.destroy();
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
    // `files` is a fresh array from listVoicesForSong on every Yjs change —
    // re-run only when the actual file set (by hash) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandId, files.map((f) => f.sha256).join(',')]);

  return { docs, imageUrls, unavailable };
}

/** Renders one page (PDF or image) at `targetWidth`, already rotated — pdf.js applies rotation during render, and the image path rotates via canvas transform. Never crops; see `cropCanvas` for that, kept separate so a crop-only change can reuse this render. */
async function renderFullPage(
  doc: PdfDoc | undefined,
  imageUrl: string | undefined,
  pageNumberInFile: number,
  targetWidth: number,
  rotation: Rotation,
): Promise<HTMLCanvasElement> {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  if (doc) {
    const page = await doc.getPage(pageNumberInFile);
    const unscaledViewport = page.getViewport({ scale: 1, rotation });
    const scale = (targetWidth / unscaledViewport.width) * dpr;
    const viewport = page.getViewport({ scale, rotation });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);

    // Tagged for the A3.1 performance checkpoint (see PR history).
    const markStart = `pdf-render-start-${Date.now()}-${Math.random()}`;
    performance.mark(markStart);
    await page.render({ canvas, viewport }).promise;
    performance.measure('pdf-page-render', markStart);

    return canvas;
  }

  if (!imageUrl) throw new Error('Page has neither a PDF document nor an image URL');
  const img = await loadImage(imageUrl);
  const swapped = rotation === 90 || rotation === 270;
  const naturalWidth = swapped ? img.naturalHeight : img.naturalWidth;
  const naturalHeight = swapped ? img.naturalWidth : img.naturalHeight;
  const scale = (targetWidth / naturalWidth) * dpr;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(naturalWidth * scale);
  canvas.height = Math.round(naturalHeight * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  const drawWidth = swapped ? canvas.height : canvas.width;
  const drawHeight = swapped ? canvas.width : canvas.height;
  ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  return canvas;
}

function PageView({
  doc,
  imageUrl,
  unavailable,
  pageNumberInFile,
  rotation,
  cropMargins,
  containerWidth,
  onPointClick,
}: {
  doc: PdfDoc | undefined;
  imageUrl: string | undefined;
  unavailable: boolean;
  pageNumberInFile: number;
  rotation: Rotation;
  cropMargins: CropMargins | undefined;
  containerWidth: number;
  /** Fractions (0-1) of this page as currently displayed — cropped and rotated. Only set during anchor calibration. */
  onPointClick?: (xFracDisplay: number, yFracDisplay: number) => void;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!doc && !imageUrl) return;
    if (!containerRef.current) return;
    let cancelled = false;
    // Render pre-crop wide enough that the cropped remainder still fills containerWidth.
    const preCropWidth =
      containerWidth / Math.max(1 - (cropMargins?.left ?? 0) - (cropMargins?.right ?? 0), 0.05);
    renderFullPage(doc, imageUrl, pageNumberInFile, preCropWidth, rotation).then((fullCanvas) => {
      if (cancelled || !containerRef.current) return;
      const shown = cropMargins ? cropCanvas(fullCanvas, cropMargins) : fullCanvas;
      shown.style.width = '100%';
      shown.style.height = 'auto';
      containerRef.current.replaceChildren(shown);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    doc,
    imageUrl,
    pageNumberInFile,
    rotation,
    containerWidth,
    cropMargins?.top,
    cropMargins?.right,
    cropMargins?.bottom,
    cropMargins?.left,
  ]);

  if (unavailable) {
    return (
      <div className="flex min-h-40 items-center justify-center bg-muted p-4 text-center text-sm text-muted-foreground" style={{ width: containerWidth }}>
        {t('pdfViewer.notAvailableOffline')}
      </div>
    );
  }

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!onPointClick) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onPointClick((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  }

  return (
    <div
      ref={containerRef}
      onClick={onPointClick ? handleClick : undefined}
      className={`min-h-40 bg-muted ${onPointClick ? 'cursor-crosshair' : ''}`}
      style={{ width: containerWidth }}
    />
  );
}

/** A focused single-page crop editor — cropping a cached full render is cheap, so sliders preview live without re-decoding the page on every tick. */
function CropEditor({
  doc,
  imageUrl,
  pageNumberInFile,
  rotation,
  containerWidth,
  initialCrop,
  onCommit,
  onCancel,
}: {
  doc: PdfDoc | undefined;
  imageUrl: string | undefined;
  pageNumberInFile: number;
  rotation: Rotation;
  containerWidth: number;
  initialCrop: CropMargins | undefined;
  onCommit: (crop: CropMargins) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [crop, setCrop] = useState<CropMargins>(initialCrop ?? NO_CROP);
  const fullCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  function redraw(nextCrop: CropMargins) {
    if (!fullCanvasRef.current || !previewRef.current) return;
    const cropped = cropCanvas(fullCanvasRef.current, nextCrop);
    cropped.style.width = '100%';
    cropped.style.height = 'auto';
    previewRef.current.replaceChildren(cropped);
  }

  useEffect(() => {
    let cancelled = false;
    renderFullPage(doc, imageUrl, pageNumberInFile, containerWidth, rotation).then((canvas) => {
      if (cancelled) return;
      fullCanvasRef.current = canvas;
      redraw(crop);
    });
    return () => {
      cancelled = true;
    };
    // Only the source page/rotation/size should trigger a re-render here —
    // `crop` changes redraw the already-cached canvas via handleChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, imageUrl, pageNumberInFile, rotation, containerWidth]);

  function handleChange(field: keyof CropMargins, value: number) {
    const next = { ...crop, [field]: value };
    setCrop(next);
    redraw(next);
  }

  return (
    <div className="space-y-2">
      <div
        ref={previewRef}
        className="min-h-40 w-full bg-muted"
        style={{ width: containerWidth }}
      />
      <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-2 text-xs sm:grid-cols-4">
        {CROP_FIELDS.map((field) => (
          <label key={field} className="flex flex-col gap-1">
            {t(
              `pdfViewer.crop${field.charAt(0).toUpperCase()}${field.slice(1)}` as `pdfViewer.crop${'Top' | 'Right' | 'Bottom' | 'Left'}`,
            )}
            <input
              type="range"
              min={0}
              max={0.49}
              step={0.01}
              value={crop[field]}
              onChange={(e) => handleChange(field, Number(e.target.value))}
            />
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onCommit(crop)}>
          {t('pdfViewer.cropSave')}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          {t('pdfViewer.cropCancel')}
        </Button>
      </div>
    </div>
  );
}

function LayoutThumbnail({
  position,
  label,
  onRotate,
  onDuplicate,
}: {
  position: number;
  label: string;
  onRotate: () => void;
  onDuplicate: () => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(position),
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex w-24 shrink-0 flex-col items-center gap-1 rounded-md border border-border p-2 ${isDragging ? 'opacity-50' : ''}`}
    >
      <div
        {...attributes}
        {...listeners}
        className="flex h-16 w-full cursor-grab items-center justify-center rounded bg-muted text-xs text-muted-foreground"
      >
        {label}
      </div>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={onRotate}
          className="text-xs text-muted-foreground hover:underline"
          aria-label={t('pdfViewer.rotatePage')}
        >
          {t('pdfViewer.rotateShort')}
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          className="text-xs text-muted-foreground hover:underline"
          aria-label={t('pdfViewer.duplicatePage')}
        >
          {t('pdfViewer.duplicateShort')}
        </button>
      </div>
    </div>
  );
}

/**
 * The anchor picker shown above the (still-navigable) normal page view while
 * calibrating — "pick an anchor, tap a point in your own document" (see
 * docs/adr/0010-anchor-sync.md). Deliberately not a separate exclusive
 * editor like CropEditor: unlike a crop (one setting for the whole voice),
 * calibrating is inherently per-page, so page navigation must stay usable.
 */
function AnchorCalibrationToolbar({
  anchors,
  calibratedAnchorIds,
  selectedAnchorId,
  onSelectAnchor,
}: {
  anchors: Anchor[];
  calibratedAnchorIds: Set<string>;
  selectedAnchorId: string | null;
  onSelectAnchor: (anchorId: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1 rounded-md border border-border p-2">
      <label className="flex flex-col gap-1 text-xs">
        {t('pdfViewer.calibrateChooseAnchor')}
        <select
          value={selectedAnchorId ?? ''}
          onChange={(e) => onSelectAnchor(e.target.value || null)}
          className="h-8 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">{t('pdfViewer.calibrateChooseAnchorPlaceholder')}</option>
          {anchors.map((anchor) => (
            <option key={anchor.id} value={anchor.id}>
              {anchor.label}
              {calibratedAnchorIds.has(anchor.id) ? ` (${t('pdfViewer.calibrateAlreadySet')})` : ''}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        {selectedAnchorId ? t('pdfViewer.calibrateInstructions') : t('pdfViewer.calibratePickFirst')}
      </p>
    </div>
  );
}

export function PdfVoiceViewer({
  bandId,
  voiceId,
  voice,
  doc,
  editable = true,
  onPageChange,
  jumpToRenderedPosition,
}: {
  bandId: string;
  voiceId: string;
  voice: FilesVoice;
  doc: Y.Doc;
  editable?: boolean;
  /** Fires whenever the currently-displayed page changes — Stage Mode's Follow Mode broadcasts from this. */
  onPageChange?: (page: { fileIndex: number; pageNumberInFile: number }) => void;
  /** An imperative "go to this position in the rendered sequence" — Stage Mode's Follow Mode applies a peer's anchor through this. Forces single-page mode, since a jump target is inherently one page. */
  jumpToRenderedPosition?: number;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<DisplayMode>('single');
  const [pageIndex, setPageIndex] = useState(0);
  const [containerWidth, setContainerWidth] = useState(800);
  const [editingLayout, setEditingLayout] = useState(false);
  const [editingCrop, setEditingCrop] = useState(false);
  const [calibratingAnchors, setCalibratingAnchors] = useState(false);
  const [selectedAnchorId, setSelectedAnchorId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const recipe = voice.displayRecipe;
  const sequence = useMemo(
    () => resolveDisplaySequence(voice.files, recipe),
    [voice.files, recipe],
  );
  const { docs, imageUrls, unavailable } = usePdfDocuments(bandId, voice.files);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const anchors = useYArray<Anchor>(doc.getArray(anchorsKey(voice.songId))).sort((a, b) => a.order - b.order);
  const calibratedAnchorIds = new Set(Object.keys(voice.anchorMap ?? {}));

  function toggleCalibratingAnchors() {
    setCalibratingAnchors((wasCalibrating) => {
      if (!wasCalibrating) setMode('single'); // calibration is inherently per-page — spread/scroll make "which page did I tap" ambiguous
      return !wasCalibrating;
    });
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const clampedIndex = Math.max(0, Math.min(pageIndex, sequence.length - 1));
  const currentPageForCallback = sequence[clampedIndex];

  // Reports the page actually on screen — only meaningful in single/spread
  // mode, since 'scroll' mode renders every page at once and `pageIndex`
  // doesn't track which one the viewer is looking at.
  useEffect(() => {
    if (mode === 'scroll' || !currentPageForCallback) return;
    onPageChange?.({ fileIndex: currentPageForCallback.fileIndex, pageNumberInFile: currentPageForCallback.pageNumberInFile });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentPageForCallback?.fileIndex, currentPageForCallback?.pageNumberInFile]);

  useEffect(() => {
    if (jumpToRenderedPosition === undefined) return;
    // Syncing local page state to an externally-driven jump target (Stage
    // Mode's Follow Mode), not a redundant re-derivation of local state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode('single');
    setPageIndex(jumpToRenderedPosition);
  }, [jumpToRenderedPosition]);

  // Current page is what's on screen; neighbors are pre-warmed into pdf.js's
  // own page cache in the background so a page turn doesn't wait on a fresh
  // parse — getPage() is cached per document, so calling it without
  // awaiting is enough.
  useEffect(() => {
    const idle =
      'requestIdleCallback' in window
        ? window.requestIdleCallback
        : (fn: () => void) => setTimeout(fn, 0);
    idle(() => {
      for (const neighborIndex of [clampedIndex - 1, clampedIndex + 1]) {
        const neighbor = sequence[neighborIndex];
        const doc = neighbor && docs.get(neighbor.file.sha256);
        if (doc) void doc.getPage(neighbor.pageNumberInFile);
      }
    });
  }, [clampedIndex, sequence, docs]);

  function commitRecipe(patch: Partial<DisplayRecipe>) {
    setVoiceDisplayRecipe(doc, voiceId, { ...recipe, ...patch });
  }

  function handleCalibrationClick(page: { fileIndex: number; pageNumberInFile: number; rotation: Rotation }) {
    return (xFracDisplay: number, yFracDisplay: number) => {
      if (!selectedAnchorId) return;
      const yPct = displayPointToSourceYPct(page.rotation, recipe?.cropMargins, xFracDisplay, yFracDisplay);
      const position: VoiceAnchorPosition = { fileIndex: page.fileIndex, page: page.pageNumberInFile, yPct };
      setVoiceAnchorPosition(doc, voiceId, selectedAnchorId, position);
    };
  }

  function handleRotate(originalIndex: number) {
    const current = recipe?.rotations?.[String(originalIndex)] ?? 0;
    commitRecipe({
      rotations: { ...recipe?.rotations, [String(originalIndex)]: ROTATION_STEP[current] },
    });
  }

  function handleDuplicate(position: number, originalIndex: number) {
    const order = recipe?.pageOrder ?? sequence.map((p) => p.originalIndex);
    commitRecipe({
      pageOrder: [...order.slice(0, position + 1), originalIndex, ...order.slice(position + 1)],
    });
  }

  function handleLayoutDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const order = recipe?.pageOrder ?? sequence.map((p) => p.originalIndex);
    commitRecipe({ pageOrder: arrayMove(order, Number(active.id), Number(over.id)) });
  }

  if (sequence.length === 0) return null;

  const currentPage = sequence[clampedIndex]!;
  const visiblePages =
    mode === 'spread'
      ? [sequence[clampedIndex], sequence[clampedIndex + 1]].filter((p) => !!p)
      : [currentPage];

  // `containerRef` (for the ResizeObserver above) lives on this outer div,
  // which stays mounted across the editingCrop toggle — if it were instead
  // on whichever inner div is conditionally swapped, the ResizeObserver
  // would keep watching the now-detached old element, which browsers
  // report as a 0×0 rect, zeroing containerWidth for everything after.
  return (
    <div ref={containerRef} className="space-y-2">
      {editingCrop ? (
        <CropEditor
          doc={docs.get(currentPage.file.sha256)}
          imageUrl={imageUrls.get(currentPage.file.sha256)}
          pageNumberInFile={currentPage.pageNumberInFile}
          rotation={currentPage.rotation}
          containerWidth={containerWidth}
          initialCrop={recipe?.cropMargins}
          onCommit={(crop) => {
            commitRecipe({ cropMargins: crop });
            setEditingCrop(false);
          }}
          onCancel={() => setEditingCrop(false)}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1">
              <Button
                variant={mode === 'single' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setMode('single')}
              >
                {t('pdfViewer.modeSingle')}
              </Button>
              <Button
                variant={mode === 'spread' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setMode('spread')}
              >
                {t('pdfViewer.modeSpread')}
              </Button>
              <Button
                variant={mode === 'scroll' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setMode('scroll')}
              >
                {t('pdfViewer.modeScroll')}
              </Button>
            </div>
            {mode !== 'scroll' && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={clampedIndex === 0}
                  onClick={() => setPageIndex(clampedIndex - 1)}
                >
                  {t('pdfViewer.prevPage')}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {t('pdfViewer.pageOf', { current: clampedIndex + 1, total: sequence.length })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={clampedIndex >= sequence.length - 1}
                  onClick={() => setPageIndex(clampedIndex + 1)}
                >
                  {t('pdfViewer.nextPage')}
                </Button>
              </div>
            )}
          </div>

          {editable && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditingLayout((v) => !v)}>
                {t('pdfViewer.editLayout')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditingCrop(true)}>
                {t('pdfViewer.editCrop')}
              </Button>
              {anchors.length > 0 && (
                <Button
                  variant={calibratingAnchors ? 'default' : 'outline'}
                  size="sm"
                  onClick={toggleCalibratingAnchors}
                >
                  {t('pdfViewer.calibrateAnchors')}
                </Button>
              )}
            </div>
          )}

          {calibratingAnchors && (
            <AnchorCalibrationToolbar
              anchors={anchors}
              calibratedAnchorIds={calibratedAnchorIds}
              selectedAnchorId={selectedAnchorId}
              onSelectAnchor={setSelectedAnchorId}
            />
          )}

          {editingLayout && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleLayoutDragEnd}
            >
              <SortableContext
                items={sequence.map((p) => String(p.position))}
                strategy={horizontalListSortingStrategy}
              >
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {sequence.map((p) => (
                    <LayoutThumbnail
                      key={p.position}
                      position={p.position}
                      label={t('pdfViewer.pageOf', {
                        current: p.position + 1,
                        total: sequence.length,
                      })}
                      onRotate={() => handleRotate(p.originalIndex)}
                      onDuplicate={() => handleDuplicate(p.position, p.originalIndex)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          <div className="w-full">
            {mode === 'scroll' ? (
              <div className="space-y-4">
                {sequence.map((p) => (
                  <PageView
                    key={p.position}
                    doc={docs.get(p.file.sha256)}
                    imageUrl={imageUrls.get(p.file.sha256)}
                    unavailable={unavailable.has(p.file.sha256)}
                    pageNumberInFile={p.pageNumberInFile}
                    rotation={p.rotation}
                    cropMargins={recipe?.cropMargins}
                    containerWidth={containerWidth}
                  />
                ))}
              </div>
            ) : (
              <div className={mode === 'spread' ? 'flex gap-2' : ''}>
                {visiblePages.map((p, i) => (
                  <PageView
                    key={p.position}
                    doc={docs.get(p.file.sha256)}
                    imageUrl={imageUrls.get(p.file.sha256)}
                    unavailable={unavailable.has(p.file.sha256)}
                    pageNumberInFile={p.pageNumberInFile}
                    rotation={p.rotation}
                    cropMargins={recipe?.cropMargins}
                    containerWidth={mode === 'spread' ? containerWidth / 2 - 4 : containerWidth}
                    onPointClick={
                      calibratingAnchors && mode === 'single' && i === 0 ? handleCalibrationClick(p) : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
