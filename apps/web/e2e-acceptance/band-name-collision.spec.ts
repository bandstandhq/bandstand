// SPDX-License-Identifier: Apache-2.0
//
// Nothing stops two bands from sharing a name — only `slug` is unique
// (apps/server/src/routes/bands.ts's create route retries with a random
// suffix on a slug collision). That's fine for routing (bands are
// addressed by id), but BandSwitcher.tsx used to render both options with
// the exact same visible text, making them unpickable. It now appends the
// (always-distinct) slug whenever a name collides — see
// apps/web/src/lib/bandOptionLabel.ts.
import { expect, test } from '@playwright/test';
import { deleteThrowawayBand, freshName, login, DEMO_OWNER_EMAIL, DEMO_PASSWORD } from './fixtures';
import { signInForToken } from './hocuspocusTestClient';

const SERVER_URL = process.env.VITE_DEFAULT_SERVER_URL ?? 'http://localhost:3001';

async function createBandNamed(token: string, name: string): Promise<{ id: string; slug: string }> {
  const res = await fetch(`${SERVER_URL}/bands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to create band: ${res.status} ${await res.text()}`);
  return res.json();
}

test('two bands with the identical name still get distinct, picklable options in the band switcher', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const sharedName = freshName('collision');
  const bandA = await createBandNamed(ownerToken, sharedName);
  const bandB = await createBandNamed(ownerToken, sharedName);
  // Confirms the premise: creation never fails or silently collides — the
  // two bands get distinct ids and distinct slugs despite the identical name.
  expect(bandA.id).not.toBe(bandB.id);
  expect(bandA.slug).not.toBe(bandB.slug);

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto('/dashboard');

    const switcher = page.getByLabel('Active band');
    await expect(switcher.locator('option', { hasText: `${sharedName} (${bandA.slug})` })).toHaveCount(1);
    await expect(switcher.locator('option', { hasText: `${sharedName} (${bandB.slug})` })).toHaveCount(1);
    // Every other (non-colliding) band this owner is in keeps its plain name.
    await expect(switcher.locator('option', { hasText: 'The Demo Band' })).toHaveText('The Demo Band');
  } finally {
    await deleteThrowawayBand(ownerToken, bandA.id);
    await deleteThrowawayBand(ownerToken, bandB.id);
  }
});
