// SPDX-License-Identifier: Apache-2.0
import { useEffect, useReducer } from 'react';
import type * as Y from 'yjs';

/** Reactively reads a Y.Array as a plain array, re-rendering on any change. */
export function useYArray<T>(array: Y.Array<T> | undefined): T[] {
  const [, forceRender] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    if (!array) return undefined;
    const observer = () => forceRender();
    array.observe(observer);
    return () => array.unobserve(observer);
  }, [array]);

  return array ? array.toArray() : [];
}
