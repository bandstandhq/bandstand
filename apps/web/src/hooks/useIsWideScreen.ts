// SPDX-License-Identifier: Apache-2.0
import { useMediaQuery } from './useMediaQuery';

// Matches Tailwind's `lg` breakpoint — kept in one place so callers don't
// duplicate the raw media query string.
const WIDE_SCREEN_QUERY = '(min-width: 1024px)';

export function useIsWideScreen(): boolean {
  return useMediaQuery(WIDE_SCREEN_QUERY);
}
