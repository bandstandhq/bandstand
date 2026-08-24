// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';
import {
  DEMO_MEMBER_EMAIL,
  DEMO_OWNER_EMAIL,
  enterStageMode,
  getActiveBandId,
  login,
  stageModeHeading,
} from './fixtures';

test('follow mode mirrors the leader\'s position within a second, until a manual scroll pauses it', async ({
  browser,
}) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  try {
    await login(alice, DEMO_OWNER_EMAIL);
    const bandId = await getActiveBandId(alice);
    await login(bob, DEMO_MEMBER_EMAIL);

    // Alice starts on the first item, Bob on the second — distinct enough
    // that following/mirroring is actually observable, not a no-op.
    await enterStageMode(alice, bandId, 'Open Mic Night', 0);
    await enterStageMode(bob, bandId, 'Open Mic Night', 1);
    const aliceStartTitle = await stageModeHeading(alice).textContent();

    await bob.getByRole('button', { name: 'Follow' }).click();
    await bob.getByRole('button', { name: /^Alice/ }).click();
    await expect(stageModeHeading(bob)).toHaveText(aliceStartTitle ?? '', { timeout: 1000 });

    // The leader moves — the follower mirrors it within a second, with no
    // action of their own.
    await alice.getByRole('button', { name: 'Next' }).click();
    const aliceNextTitle = await stageModeHeading(alice).textContent();
    expect(aliceNextTitle).not.toBe(aliceStartTitle);
    await expect(stageModeHeading(bob)).toHaveText(aliceNextTitle ?? '', { timeout: 1000 });

    // Bob scrolling manually pauses following — his view stops tracking
    // Alice, and a "Back to Alice" resume control appears.
    const bobContentArea = bob.locator('.stage-item-transition');
    await bobContentArea.hover();
    await bob.mouse.wheel(0, 200);
    await expect(bob.getByRole('button', { name: /^Back to Alice/ })).toBeVisible();

    await alice.getByRole('button', { name: 'Next' }).click();
    const aliceThirdTitle = await stageModeHeading(alice).textContent();
    // Give it a real beat to (not) arrive — the point is it must not.
    await bob.waitForTimeout(1000);
    await expect(stageModeHeading(bob)).not.toHaveText(aliceThirdTitle ?? '');

    // Resuming picks the leader's *current* position back up.
    await bob.getByRole('button', { name: /^Back to Alice/ }).click();
    await expect(stageModeHeading(bob)).toHaveText(aliceThirdTitle ?? '', { timeout: 1000 });
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});
