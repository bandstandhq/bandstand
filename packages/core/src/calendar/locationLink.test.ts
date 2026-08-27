// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { buildLocationHref } from './locationLink';

describe('buildLocationHref', () => {
  it('builds a geo: URI when coordinates are given', () => {
    expect(buildLocationHref('123 Main St', { lat: 52.5, lng: 13.4 })).toBe('geo:52.5,13.4');
  });

  it('coordinates take precedence over the text, even when both are present', () => {
    expect(buildLocationHref('Somewhere else entirely', { lat: -33.8, lng: 151.2 })).toBe('geo:-33.8,151.2');
  });

  it('falls back to a Google Maps search URL when there are no coordinates', () => {
    expect(buildLocationHref('The Venue, 123 Main St')).toBe(
      'https://www.google.com/maps/search/?api=1&query=The%20Venue%2C%20123%20Main%20St',
    );
  });

  it('returns undefined for an empty location and no coordinates', () => {
    expect(buildLocationHref('')).toBeUndefined();
    expect(buildLocationHref('   ')).toBeUndefined();
  });
});
