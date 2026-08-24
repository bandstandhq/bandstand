// SPDX-License-Identifier: Apache-2.0
//
// Drives two real Hocuspocus connections directly (not the drag-and-drop
// UI) — this scenario is about whether Yjs's CRDT merge loses either
// concurrent edit, not about dnd-kit's mouse-event handling. See
// hocuspocusTestClient.ts.
import { addSetlistItem, buildBreakItem, itemsKey } from '@bandstand/core';
import type { SetlistItem } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';
import { DEMO_MEMBER_EMAIL, DEMO_OWNER_EMAIL, DEMO_PASSWORD } from './fixtures';
import { getBandIdBySlug, getSetlistIdByName, withDb } from './testDb';

test('two concurrent setlist edits merge without losing either', async () => {
  const bandId = await withDb((client) => getBandIdBySlug(client, 'demo-band'));
  const setlistId = await withDb((client) => getSetlistIdByName(client, bandId, 'Full Band Practice Set'));

  const [aliceToken, bobToken] = await Promise.all([
    signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD),
    signInForToken(DEMO_MEMBER_EMAIL, DEMO_PASSWORD),
  ]);

  const alice = connectTestBandDoc(bandId, aliceToken);
  const bob = connectTestBandDoc(bandId, bobToken);

  try {
    await Promise.all([alice.waitForSynced(), bob.waitForSynced()]);

    const aliceMinutes = 1000 + Math.floor(Math.random() * 1000);
    const bobMinutes = 2000 + Math.floor(Math.random() * 1000);

    // No await between these two — the whole point is that both are
    // applied to their own local doc before either has heard back from
    // the other, exactly the race a CRDT has to merge correctly.
    addSetlistItem(alice.doc, setlistId, buildBreakItem(aliceMinutes));
    addSetlistItem(bob.doc, setlistId, buildBreakItem(bobMinutes));

    const observer = connectTestBandDoc(bandId, aliceToken);
    try {
      await observer.waitForSynced();
      const deadline = Date.now() + 10000;
      let items: SetlistItem[] = [];
      while (Date.now() < deadline) {
        items = observer.doc.getArray<SetlistItem>(itemsKey(setlistId)).toJSON();
        const hasBoth =
          items.some((i) => i.type === 'break' && i.breakMinutes === aliceMinutes) &&
          items.some((i) => i.type === 'break' && i.breakMinutes === bobMinutes);
        if (hasBoth) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(items.some((i) => i.type === 'break' && i.breakMinutes === aliceMinutes)).toBe(true);
      expect(items.some((i) => i.type === 'break' && i.breakMinutes === bobMinutes)).toBe(true);
    } finally {
      observer.provider.destroy();
    }
  } finally {
    alice.provider.destroy();
    bob.provider.destroy();
  }
});
