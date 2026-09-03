// SPDX-License-Identifier: Apache-2.0
import type { Theme } from '@bandstand/core';

/**
 * Resolves 'system' to the OS's actual light/dark preference; a plain
 * 'dark'/'light' choice passes through unchanged and ignores the OS
 * entirely. `systemPrefersLight` is expected to come from
 * `useMediaQuery('(prefers-color-scheme: light)')` at the call site, so
 * this stays a plain, easily-testable function rather than a hook itself.
 */
export function resolveTheme(theme: Theme, systemPrefersLight: boolean): 'light' | 'dark' {
  if (theme === 'system') return systemPrefersLight ? 'light' : 'dark';
  return theme;
}
