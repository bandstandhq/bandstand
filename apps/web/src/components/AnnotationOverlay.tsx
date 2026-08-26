// SPDX-License-Identifier: Apache-2.0
//
// Strictly personal drawing on a voice's current page — pen/highlighter/
// eraser/shapes/text, organized into named, individually toggleable layers,
// one of which can be explicitly shared as a frozen copy. Never in the
// band's Yjs document (see packages/core/src/schemas/annotation.ts and B4
// of the Milestone 2 Teil B plan). A single absolutely-positioned canvas
// laid over whatever page is currently rendered — coordinates are fractions
// of that on-screen page, exactly as displayed (cropped/rotated already
// applied), never a source-file coordinate the way an anchor's yPct is.
import type { AnnotationLayerDto } from '@bandstand/api-client';
import type { AnnotationObject, AnnotationPoint } from '@bandstand/core';
import { Button } from '@bandstand/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type CachedLayer,
  deleteCachedLayer,
  flushPendingEdits,
  getCachedLayers,
  recordLocalEdit,
  syncLayersForVoice,
} from '../lib/annotationCache';
import { apiClient } from '../lib/api-client';

type Tool = 'none' | 'pen' | 'highlighter' | 'eraser' | 'rect' | 'ellipse' | 'line' | 'text';
const DRAW_TOOLS: Tool[] = ['pen', 'highlighter', 'eraser', 'rect', 'ellipse', 'line', 'text'];
const ERASE_RADIUS_FRACTION = 0.02;

function distanceToSegment(p: AnnotationPoint, a: AnnotationPoint, b: AnnotationPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  const closestX = a.x + t * dx;
  const closestY = a.y + t * dy;
  return Math.hypot(p.x - closestX, p.y - closestY);
}

function objectIntersects(obj: AnnotationObject, p: AnnotationPoint): boolean {
  if (obj.type === 'pen' || obj.type === 'highlighter') {
    return obj.points.some((pt, i) => i > 0 && distanceToSegment(p, obj.points[i - 1]!, pt) < ERASE_RADIUS_FRACTION);
  }
  if (obj.type === 'rect' || obj.type === 'ellipse' || obj.type === 'line') {
    return distanceToSegment(p, obj.start, obj.end) < ERASE_RADIUS_FRACTION;
  }
  return Math.hypot(p.x - obj.position.x, p.y - obj.position.y) < ERASE_RADIUS_FRACTION * 2;
}

function drawObject(ctx: CanvasRenderingContext2D, obj: AnnotationObject, w: number, h: number): void {
  ctx.save();
  ctx.strokeStyle = obj.color;
  ctx.fillStyle = obj.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (obj.type === 'pen' || obj.type === 'highlighter') {
    ctx.globalAlpha = obj.type === 'highlighter' ? obj.opacity : 1;
    ctx.lineWidth = obj.width;
    ctx.beginPath();
    obj.points.forEach((pt, i) => {
      const x = pt.x * w;
      const y = pt.y * h;
      const pressureWidth = pt.pressure && pt.pressure > 0 ? obj.width * (0.4 + pt.pressure) : obj.width;
      ctx.lineWidth = pressureWidth;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  } else if (obj.type === 'rect') {
    ctx.lineWidth = obj.width;
    ctx.strokeRect(obj.start.x * w, obj.start.y * h, (obj.end.x - obj.start.x) * w, (obj.end.y - obj.start.y) * h);
  } else if (obj.type === 'ellipse') {
    ctx.lineWidth = obj.width;
    const cx = ((obj.start.x + obj.end.x) / 2) * w;
    const cy = ((obj.start.y + obj.end.y) / 2) * h;
    const rx = Math.abs(obj.end.x - obj.start.x) / 2 * w;
    const ry = Math.abs(obj.end.y - obj.start.y) / 2 * h;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (obj.type === 'line') {
    ctx.lineWidth = obj.width;
    ctx.beginPath();
    ctx.moveTo(obj.start.x * w, obj.start.y * h);
    ctx.lineTo(obj.end.x * w, obj.end.y * h);
    ctx.stroke();
  } else if (obj.type === 'text') {
    ctx.font = `${obj.fontSize}px sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(obj.text, obj.position.x * w, obj.position.y * h);
  }
  ctx.restore();
}

export function AnnotationOverlay({ bandId, voiceId, page }: { bandId: string; voiceId: string; page: number }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [layers, setLayers] = useState<CachedLayer[]>([]);
  // Read-only, frozen copies other members shared — never editable here,
  // never routed through the local write-through cache (there's nothing of
  // this viewer's own to keep offline-durable about someone else's copy).
  const [sharedLayers, setSharedLayers] = useState<AnnotationLayerDto[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [hiddenLayerIds, setHiddenLayerIds] = useState<Set<string>>(new Set());
  const [tool, setTool] = useState<Tool>('none');
  const [color, setColor] = useState('#ff3b30');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const drawingRef = useRef<{ points: AnnotationPoint[]; start?: AnnotationPoint } | null>(null);
  const [, forceRedraw] = useState(0);

  const activeLayer = layers.find((l) => l.layer.id === activeLayerId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await getCachedLayers(voiceId);
      if (!cancelled && cached.length > 0) setLayers(cached);
      const synced = await syncLayersForVoice(apiClient, bandId, voiceId);
      if (!cancelled) setLayers(synced);
      try {
        const shared = await apiClient.listSharedAnnotationLayers(bandId, voiceId);
        if (!cancelled) setSharedLayers(shared);
      } catch {
        // Offline or unreachable — shared layers just don't show up this session.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bandId, voiceId]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const visibleObjectsByPage = useMemo(() => {
    const objects: AnnotationObject[] = [];
    for (const record of layers) {
      if (hiddenLayerIds.has(record.layer.id)) continue;
      objects.push(...record.layer.objects.filter((o) => o.page === page));
    }
    for (const shared of sharedLayers) {
      if (hiddenLayerIds.has(shared.id)) continue;
      objects.push(...shared.objects.filter((o) => o.page === page));
    }
    return objects;
  }, [layers, sharedLayers, hiddenLayerIds, page]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    for (const obj of visibleObjectsByPage) drawObject(ctx, obj, size.width, size.height);
    if (drawingRef.current && (tool === 'pen' || tool === 'highlighter')) {
      drawObject(
        ctx,
        {
          id: 'preview',
          type: tool,
          page,
          color,
          width: strokeWidth,
          points: drawingRef.current.points,
          ...(tool === 'highlighter' ? { opacity: 0.35 } : {}),
        } as AnnotationObject,
        size.width,
        size.height,
      );
    } else if (drawingRef.current?.start && (tool === 'rect' || tool === 'ellipse' || tool === 'line')) {
      const last = drawingRef.current.points.at(-1);
      if (last) {
        drawObject(
          ctx,
          { id: 'preview', type: tool, page, color, width: strokeWidth, start: drawingRef.current.start, end: last } as AnnotationObject,
          size.width,
          size.height,
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, visibleObjectsByPage, tool, color, strokeWidth]);

  async function persistActiveLayer(objects: AnnotationObject[]) {
    if (!activeLayer) return;
    const nextLayer: AnnotationLayerDto = { ...activeLayer.layer, objects };
    setLayers((prev) => prev.map((l) => (l.layer.id === nextLayer.id ? { ...l, layer: nextLayer } : l)));
    await recordLocalEdit(bandId, activeLayer.layer, objects, activeLayer.layer.updatedAt);
    await flushPendingEdits(apiClient, bandId, voiceId);
    const refreshed = await getCachedLayers(voiceId);
    setLayers(refreshed);
  }

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>): AnnotationPoint {
    const rect = e.currentTarget.getBoundingClientRect();
    const point: AnnotationPoint = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
    if (e.pointerType === 'pen') point.pressure = e.pressure;
    return point;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (tool === 'none' || !activeLayer) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const point = pointFromEvent(e);

    if (tool === 'text') {
      const text = window.prompt(t('annotations.textPrompt'));
      if (text?.trim()) {
        void persistActiveLayer([
          ...activeLayer.layer.objects,
          { id: crypto.randomUUID(), type: 'text', page, position: point, text: text.trim(), color, fontSize: 16 },
        ]);
      }
      return;
    }

    if (tool === 'eraser') {
      const remaining = activeLayer.layer.objects.filter((o) => o.page !== page || !objectIntersects(o, point));
      if (remaining.length !== activeLayer.layer.objects.length) void persistActiveLayer(remaining);
      drawingRef.current = { points: [point] };
      return;
    }

    drawingRef.current = tool === 'pen' || tool === 'highlighter' ? { points: [point] } : { points: [point], start: point };
    forceRedraw((n) => n + 1);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || tool === 'none' || !activeLayer) return;
    const point = pointFromEvent(e);

    if (tool === 'eraser') {
      const remaining = activeLayer.layer.objects.filter((o) => o.page !== page || !objectIntersects(o, point));
      if (remaining.length !== activeLayer.layer.objects.length) void persistActiveLayer(remaining);
      return;
    }

    if (tool === 'pen' || tool === 'highlighter') {
      drawingRef.current.points.push(point);
    } else {
      drawingRef.current.points = [drawingRef.current.start!, point];
    }
    forceRedraw((n) => n + 1);
  }

  function handlePointerUp() {
    if (!drawingRef.current || !activeLayer) return;
    const { points, start } = drawingRef.current;
    drawingRef.current = null;

    if ((tool === 'pen' || tool === 'highlighter') && points.length >= 2) {
      const base = { id: crypto.randomUUID(), page, color, width: strokeWidth, points };
      void persistActiveLayer([
        ...activeLayer.layer.objects,
        tool === 'pen' ? { ...base, type: 'pen' } : { ...base, type: 'highlighter', opacity: 0.35 },
      ]);
    } else if ((tool === 'rect' || tool === 'ellipse' || tool === 'line') && start && points.length >= 1) {
      const end = points.at(-1)!;
      void persistActiveLayer([
        ...activeLayer.layer.objects,
        { id: crypto.randomUUID(), type: tool, page, color, width: strokeWidth, start, end },
      ]);
    } else {
      forceRedraw((n) => n + 1);
    }
  }

  async function handleCreateLayer() {
    const name = window.prompt(t('annotations.newLayerPrompt'));
    if (!name?.trim()) return;
    const created = await apiClient.createAnnotationLayer(bandId, voiceId, { name: name.trim() });
    const refreshed = await syncLayersForVoice(apiClient, bandId, voiceId);
    setLayers(refreshed);
    setActiveLayerId(created.id);
  }

  async function handleShareLayer(layerId: string) {
    await apiClient.shareAnnotationLayer(bandId, layerId);
  }

  async function handleDeleteLayer(layerId: string) {
    if (!window.confirm(t('annotations.confirmDelete'))) return;
    try {
      await apiClient.deleteAnnotationLayer(bandId, layerId);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
      return;
    }
    await deleteCachedLayer(layerId);
    if (activeLayerId === layerId) setActiveLayerId(null);
    setLayers((prev) => prev.filter((l) => l.layer.id !== layerId));
    setSharedLayers((prev) => prev.filter((l) => l.id !== layerId));
  }

  function toggleLayerVisibility(layerId: string) {
    setHiddenLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      <canvas
        ref={canvasRef}
        className={`h-full w-full ${tool !== 'none' ? 'pointer-events-auto touch-none' : ''}`}
        style={{ cursor: tool !== 'none' ? 'crosshair' : 'default' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />

      <div className="pointer-events-auto absolute right-1 top-1 flex flex-wrap items-center gap-1 rounded-md bg-background/90 p-1 text-xs shadow">
        {DRAW_TOOLS.map((toolOption) => (
          <button
            key={toolOption}
            type="button"
            onClick={() => setTool((current) => (current === toolOption ? 'none' : toolOption))}
            className={`rounded px-1.5 py-1 ${tool === toolOption ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
          >
            {t(`annotations.tool_${toolOption}`)}
          </button>
        ))}
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0" />
        <input
          type="range"
          min={1}
          max={20}
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(Number(e.target.value))}
          className="w-14"
        />
        <button type="button" onClick={() => setShowLayerPanel((v) => !v)} className="rounded px-1.5 py-1 hover:bg-muted">
          {t('annotations.layers')}
        </button>
      </div>

      {showLayerPanel && (
        <div className="pointer-events-auto absolute right-1 top-9 w-56 space-y-2 rounded-md border border-border bg-background p-2 text-xs shadow">
          {layers.length === 0 && <p className="text-muted-foreground">{t('annotations.noLayers')}</p>}
          <ul className="space-y-1">
            {layers.map(({ layer }) => (
              <li key={layer.id} className="flex items-center gap-1">
                <input type="checkbox" checked={!hiddenLayerIds.has(layer.id)} onChange={() => toggleLayerVisibility(layer.id)} />
                <button
                  type="button"
                  onClick={() => setActiveLayerId(layer.id)}
                  className={`flex-1 truncate text-left ${activeLayerId === layer.id ? 'font-semibold' : ''}`}
                >
                  {layer.name}
                  {layer.shared && ` (${t('annotations.sharedBadge')})`}
                </button>
                {!layer.shared && (
                  <button type="button" onClick={() => handleShareLayer(layer.id)} className="text-primary hover:underline">
                    {t('annotations.share')}
                  </button>
                )}
                <button type="button" onClick={() => handleDeleteLayer(layer.id)} className="text-destructive hover:underline">
                  {t('annotations.delete')}
                </button>
              </li>
            ))}
            {sharedLayers.map((layer) => (
              <li key={layer.id} className="flex items-center gap-1 text-muted-foreground">
                <input type="checkbox" checked={!hiddenLayerIds.has(layer.id)} onChange={() => toggleLayerVisibility(layer.id)} />
                <span className="flex-1 truncate">
                  {layer.name} ({t('annotations.sharedBadge')})
                </span>
                <button type="button" onClick={() => handleDeleteLayer(layer.id)} className="text-destructive hover:underline">
                  {t('annotations.delete')}
                </button>
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" size="sm" onClick={handleCreateLayer} className="w-full">
            {t('annotations.newLayer')}
          </Button>
        </div>
      )}
    </div>
  );
}
