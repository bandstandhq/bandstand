// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { annotationLayerSchema, annotationObjectSchema } from './annotation';

const point = (x: number, y: number) => ({ x, y });

describe('annotationObjectSchema', () => {
  it('accepts a pen stroke', () => {
    const obj = { id: 'o1', type: 'pen', page: 0, color: '#000', width: 2, points: [point(0.1, 0.1), point(0.2, 0.2)] };
    expect(annotationObjectSchema.parse(obj)).toEqual(obj);
  });

  it('accepts pressure on individual points, and tolerates points without it', () => {
    const obj = {
      id: 'o1',
      type: 'pen',
      page: 0,
      color: '#000',
      width: 2,
      points: [{ x: 0.1, y: 0.1, pressure: 0.8 }, point(0.2, 0.2)],
    };
    expect(() => annotationObjectSchema.parse(obj)).not.toThrow();
  });

  it('defaults a highlighter\'s opacity when omitted', () => {
    const obj = { id: 'o1', type: 'highlighter', page: 0, color: '#ff0', width: 8, points: [point(0, 0), point(1, 1)] };
    expect(annotationObjectSchema.parse(obj)).toMatchObject({ opacity: 0.35 });
  });

  it('accepts each shape type', () => {
    for (const type of ['rect', 'ellipse', 'line'] as const) {
      const obj = { id: 'o1', type, page: 0, color: '#000', width: 2, start: point(0, 0), end: point(0.5, 0.5) };
      expect(() => annotationObjectSchema.parse(obj)).not.toThrow();
    }
  });

  it('accepts a text box', () => {
    const obj = { id: 'o1', type: 'text', page: 0, position: point(0.1, 0.1), text: 'Watch the key change', color: '#000', fontSize: 14 };
    expect(() => annotationObjectSchema.parse(obj)).not.toThrow();
  });

  it('rejects a pen stroke with fewer than two points', () => {
    expect(() =>
      annotationObjectSchema.parse({ id: 'o1', type: 'pen', page: 0, color: '#000', width: 2, points: [point(0, 0)] }),
    ).toThrow();
  });

  it('rejects a point coordinate outside 0-1', () => {
    expect(() =>
      annotationObjectSchema.parse({ id: 'o1', type: 'pen', page: 0, color: '#000', width: 2, points: [point(1.5, 0), point(0, 0)] }),
    ).toThrow();
  });

  it('rejects an unknown object type', () => {
    expect(() => annotationObjectSchema.parse({ id: 'o1', type: 'eraser', page: 0 })).toThrow();
  });
});

describe('annotationLayerSchema', () => {
  it('accepts an empty layer', () => {
    expect(() => annotationLayerSchema.parse({ id: 'l1', name: 'Rehearsal May', objects: [] })).not.toThrow();
  });

  it('accepts a layer with mixed object types', () => {
    const layer = {
      id: 'l1',
      name: 'Gig June',
      objects: [
        { id: 'o1', type: 'pen', page: 0, color: '#000', width: 2, points: [point(0, 0), point(1, 1)] },
        { id: 'o2', type: 'text', page: 1, position: point(0.5, 0.5), text: 'D.C. al Fine', color: '#f00', fontSize: 16 },
      ],
    };
    expect(() => annotationLayerSchema.parse(layer)).not.toThrow();
  });

  it('rejects a layer with an empty name', () => {
    expect(() => annotationLayerSchema.parse({ id: 'l1', name: '', objects: [] })).toThrow();
  });
});
