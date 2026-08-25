// SPDX-License-Identifier: Apache-2.0
//
// A convenience list for the instrument multi-select in the member list UI
// — not a validation allowlist. band_members.instruments accepts any
// free-text string (see updateMyInstrumentsInputSchema); this is only
// offered as known options alongside a free-text add field.
export const COMMON_INSTRUMENTS: readonly string[] = [
  'Vocals',
  'Guitar',
  'Bass',
  'Drums',
  'Keyboard',
  'Piano',
  'Saxophone',
  'Trumpet',
  'Trombone',
  'Violin',
  'Cello',
  'Flute',
  'Clarinet',
  'Harmonica',
  'Percussion',
  'Ukulele',
  'Banjo',
  'Synthesizer',
];
