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
  // 2000 points is several times what one continuous stroke needs even at a
  // high stylus sampling rate (60-120 Hz) over multiple seconds.
  points: z.array(pointSchema).min(2).max(2000),
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
  // Generous for a multi-line margin note, well beyond a realistic
  // single annotation comment.
  text: z.string().min(1).max(2000),
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

// 5000 objects covers even a densely annotated ~16-page voice (up to ~300
// pen/shape/text objects per page — dynamics, breath marks, fingerings —
// each object carries its own `page` field, so one layer can span a whole
// multi-page voice) with headroom to spare.
const MAX_ANNOTATION_OBJECTS = 5000;

export const annotationLayerSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  objects: z.array(annotationObjectSchema).max(MAX_ANNOTATION_OBJECTS),
});

export type AnnotationLayer = z.infer<typeof annotationLayerSchema>;

export const createAnnotationLayerInputSchema = z.object({
  name: z.string().min(1),
});

export type CreateAnnotationLayerInput = z.infer<typeof createAnnotationLayerInputSchema>;

// `expectedUpdatedAt` is the updatedAt the client's edit was based on — the
// server applies the update only if it still matches, forking a
// "(Conflict Copy)" layer instead of overwriting when it doesn't (the same
// person editing offline on two devices before either reconnects is a real
// case, not a theoretical one — see docs/adr/0010-anchor-sync.md's sibling
// design note in the Teil B plan).
export const updateAnnotationLayerInputSchema = z.object({
  objects: z.array(annotationObjectSchema).max(MAX_ANNOTATION_OBJECTS),
  expectedUpdatedAt: z.string(),
});

export type UpdateAnnotationLayerInput = z.infer<typeof updateAnnotationLayerInputSchema>;
