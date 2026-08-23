// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';

// Matches Tailwind's `lg` breakpoint — kept in one place so callers don't
// duplicate the raw media query string.
const WIDE_SCREEN_QUERY = '(min-width: 1024px)';

export function useIsWideScreen(): boolean {
  const [isWide, setIsWide] = useState(() => window.matchMedia(WIDE_SCREEN_QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(WIDE_SCREEN_QUERY);
    const handleChange = (event: MediaQueryListEvent) => setIsWide(event.matches);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  return isWide;
}
