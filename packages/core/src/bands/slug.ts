// SPDX-License-Identifier: Apache-2.0

/** Lowercases, replaces non-alphanumeric runs with a single "-", trims leading/trailing "-". */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
