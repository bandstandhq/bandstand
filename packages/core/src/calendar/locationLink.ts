// SPDX-License-Identifier: Apache-2.0
import type { LocationGeo } from '../schemas/event';

/**
 * A link that opens an event's location in the device's own map app — a
 * `geo:` URI when coordinates are known (every mobile OS already registers
 * as a handler for it), else a universal browser fallback search URL. No
 * platform sniffing, no embedded map, no API key: just a link. See
 * docs/adr/0011-calendar-events.md.
 */
export function buildLocationHref(location: string, locationGeo?: LocationGeo): string | undefined {
  if (locationGeo) return `geo:${locationGeo.lat},${locationGeo.lng}`;
  if (location.trim().length === 0) return undefined;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}
