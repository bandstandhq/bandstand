// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';

/**
 * Backs conditional single-render layout switches (e.g. a table vs. its
 * narrow-screen card equivalent) — CSS-only `hidden md:block` /
 * `md:hidden` pairs render *both* variants into the DOM at once, which
 * duplicates every accessible name in them and breaks any test (or screen
 * reader) that looks up content by text without also disambiguating which
 * variant it means. Rendering only one side in React avoids that.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handleChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [query]);

  return matches;
}
