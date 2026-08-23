// SPDX-License-Identifier: Apache-2.0
import { useEffect, useReducer } from 'react';
import type * as Y from 'yjs';

/** Reactively reads a Y.Map as a plain object, re-rendering on any change. */
export function useYMap<T>(map: Y.Map<T> | undefined): Record<string, T> {
  const [, forceRender] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    if (!map) return undefined;
    const observer = () => forceRender();
    map.observe(observer);
    return () => map.unobserve(observer);
  }, [map]);

  return map ? (map.toJSON() as Record<string, T>) : {};
}
