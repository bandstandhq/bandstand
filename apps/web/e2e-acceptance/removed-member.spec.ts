// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';
import { freshEmail, signUp } from './fixtures';
import { addBandMember, getBandIdBySlug, getUserIdByEmail, removeBandMember, withDb } from './testDb';

test('a removed member\'s cached band content clears on the next reconnect', async ({ page }) => {
  const email = freshEmail('temp-member');
  await page.goto('/signup');
  await signUp(page, { name: 'Temp Member', email });
  await page.waitForURL(/\/dashboard$/);

  const bandId = await withDb(async (client) => {
    const band = await getBandIdBySlug(client, 'demo-band');
    const userId = await getUserIdByEmail(client, email);
    await addBandMember(client, band, userId);
    return band;
  });

  // A real, currently-valid membership: confirm content actually loads
  // (and gets cached locally) before revoking it.
  await page.goto(`/bands/${bandId}/repertoire`);
  await expect(page.getByText('Amazing Grace')).toBeVisible();

  await withDb(async (client) => {
    const userId = await getUserIdByEmail(client, email);
    await removeBandMember(client, bandId, userId);
  });

  // Reload forces a brand-new Hocuspocus connection attempt (and a fresh
  // REST membership check) — both must now say "not a member", and the
  // previously-cached content must not survive that.
  await page.reload();
  await expect(page.getByText('Amazing Grace')).not.toBeVisible();
  await expect(page.getByText("You're not a member of this band, so its content isn't available here.")).toBeVisible();

  await withDb(async (client) => {
    const userId = await getUserIdByEmail(client, email);
    await client.query('delete from users where id = $1', [userId]);
  });
});
