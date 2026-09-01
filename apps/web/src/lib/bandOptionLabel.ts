// SPDX-License-Identifier: Apache-2.0
import type { MyBand } from '@bandstand/api-client';

/**
 * Plain `band.name` — unless this user belongs to more than one band with
 * that exact name (nothing stops two bands from sharing a name; only
 * `slug` is unique — see apps/server/src/routes/bands.ts's create route),
 * in which case two BandSwitcher options would otherwise be visually
 * identical and unpickable. `slug` is always distinct between any two
 * bands and already ships with every `MyBand`, so it's a free,
 * always-available disambiguator — no extra request needed to tell them
 * apart.
 */
export function bandOptionLabel(band: MyBand, allBands: MyBand[]): string {
  const nameIsAmbiguous = allBands.filter((b) => b.name === band.name).length > 1;
  return nameIsAmbiguous ? `${band.name} (${band.slug})` : band.name;
}
