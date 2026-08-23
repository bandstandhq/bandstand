// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { slugify } from './slug';

describe('slugify', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugify('The Demo Band')).toBe('the-demo-band');
  });

  it('collapses runs of non-alphanumeric characters', () => {
    expect(slugify('Foo & Bar!!  Baz')).toBe('foo-bar-baz');
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugify('!!Weird Name!!')).toBe('weird-name');
  });

  it('returns an empty string for input with no alphanumeric characters', () => {
    expect(slugify('!!!')).toBe('');
  });
});
