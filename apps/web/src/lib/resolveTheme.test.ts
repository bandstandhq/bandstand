// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { resolveTheme } from './resolveTheme';

describe('resolveTheme', () => {
  it('passes an explicit dark/light choice through unchanged, ignoring the OS preference', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('resolves system to light or dark based on the OS preference', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
  });
});
