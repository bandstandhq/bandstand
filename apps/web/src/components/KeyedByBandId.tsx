// SPDX-License-Identifier: Apache-2.0
import type { ComponentType } from 'react';
import { useParams } from 'react-router';

/**
 * Remounts `Component` whenever the `:bandId` route param changes. React
 * Router doesn't remount a route's element just because a param changed —
 * without this, switching bands while on one of these routes would carry
 * over whatever local state the page had (search text, an open filter, a
 * selected-but-now-wrong-band song) instead of resetting it, because it's
 * still the same component instance. Putting `key` here once is what makes
 * that reset "fall out" of navigation for every page, instead of needing
 * its own teardown effect.
 */
export function KeyedByBandId({ Component }: { Component: ComponentType }) {
  const { bandId } = useParams<{ bandId: string }>();
  return <Component key={bandId} />;
}
