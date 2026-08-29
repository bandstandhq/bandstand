// SPDX-License-Identifier: Apache-2.0
//
// The completeness guarantee bandRouteConfig.ts's own docstring promises:
// every band-scoped route shape has a component paired with it in
// router.tsx. Catches the case a hand-maintained mapping would silently
// miss — adding a path to bandRouteShapes without ever wiring up its
// <Route> at all — as a failing test instead of a page that 404s.
import { describe, expect, it } from 'vitest';
import { bandRouteShapes } from './routes/bandRouteConfig';
import { bandRouteComponents } from './router';

describe('bandRouteComponents', () => {
  it('has exactly one entry per bandRouteShapes path — no more, no fewer', () => {
    const shapePaths = new Set(bandRouteShapes.map((r) => r.path));
    const componentPaths = new Set(Object.keys(bandRouteComponents));
    expect(componentPaths).toEqual(shapePaths);
  });
});
