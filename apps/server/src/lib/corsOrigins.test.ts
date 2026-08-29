// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseAllowedOrigins } from './corsOrigins';

describe('parseAllowedOrigins', () => {
  it('defaults to the local dev origin when unset', () => {
    expect(parseAllowedOrigins(undefined)).toEqual(['http://localhost:5173']);
  });

  it('splits a comma-separated list and trims whitespace', () => {
    expect(parseAllowedOrigins('http://localhost:5173, http://192.168.1.50:5173 ')).toEqual([
      'http://localhost:5173',
      'http://192.168.1.50:5173',
    ]);
  });

  it('drops empty entries from a trailing or doubled comma', () => {
    expect(parseAllowedOrigins('http://localhost:5173,,')).toEqual(['http://localhost:5173']);
  });

  it('passes a single origin through unchanged', () => {
    expect(parseAllowedOrigins('https://app.bandstand.example')).toEqual(['https://app.bandstand.example']);
  });
});
