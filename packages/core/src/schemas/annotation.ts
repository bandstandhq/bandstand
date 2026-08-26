// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

// Strictly personal drawing/markup on a voice — never in the band's Yjs
// document, stored in Postgres + a local cache instead (see B4 of Milestone
// 2 Teil B). A layer holds whatever was drawn on it; "erase" is a client
// interaction that removes/trims existing objects, not an object type of
// its own — there is nothing to persist about an eraser stroke once it's
// done its job.
const pointSchema = z.object({
  // Fraction of the page's width/height (0-1), same device-independent
  // convention as a files voice's anchorMap yPct — never a pixel coordinate.
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  // From PointerEvent.pressure where the stylus reports it; absent (not 0 —
  // 0 is a real "no pressure support" signal) when never sampled.
  pressure: z.number().min(0).max(1).optional(),
});

export type AnnotationPoint = z.infer<typeof pointSchema>;

const strokeFields = {
  id: z.string(),
  // The page's position in the voice's *rendered* sequence (i.e.
  // ResolvedPage.position from yjs/voices.ts) — unlike an anchor's
  // fileIndex/page, an annotation is drawn on what's on screen right now,
  // display recipe already applied.
  page: z.number().int().nonnegative(),
  color: z.string().min(1),
  width: z.number().positive(),
  points: z.array(pointSchema).min(2),
};

const penObjectSchema = z.object({ ...strokeFields, type: z.literal('pen') });
const highlighterObjectSchema = z.object({
  ...strokeFields,
  type: z.literal('highlighter'),
  opacity: z.number().min(0).max(1).default(0.35),
});

const shapeFields = {
  id: z.string(),
  page: z.number().int().nonnegative(),
  color: z.string().min(1),
  width: z.number().positive(),
  start: pointSchema,
  end: pointSchema,
};

const rectObjectSchema = z.object({ ...shapeFields, type: z.literal('rect') });
const ellipseObjectSchema = z.object({ ...shapeFields, type: z.literal('ellipse') });
const lineObjectSchema = z.object({ ...shapeFields, type: z.literal('line') });

const textObjectSchema = z.object({
  id: z.string(),
  type: z.literal('text'),
  page: z.number().int().nonnegative(),
  position: pointSchema,
  text: z.string().min(1),
  color: z.string().min(1),
  fontSize: z.number().positive(),
});

export const annotationObjectSchema = z.discriminatedUnion('type', [
  penObjectSchema,
  highlighterObjectSchema,
  rectObjectSchema,
  ellipseObjectSchema,
  lineObjectSchema,
  textObjectSchema,
]);

export type AnnotationObject = z.infer<typeof annotationObjectSchema>;

export const annotationLayerSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  objects: z.array(annotationObjectSchema),
});

export type AnnotationLayer = z.infer<typeof annotationLayerSchema>;
