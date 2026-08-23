// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Needs a real Postgres and a real WebSocket round-trip — the whole point
// is proving a non-member's connection is genuinely rejected by the real
// Hocuspocus server, not just that getBandMembership() returns null in
// isolation. Closes https://github.com/bandstandhq/bandstand/issues/1.
import { randomUUID } from 'node:crypto';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { eq } from 'drizzle-orm';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { bandMembers, bands, users } from '../db/schema/index';
import { auth } from './auth';
import { hocuspocusServer } from './hocuspocus';

async function signUpTestUser() {
  const email = `hocuspocus-auth-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'HP Tester' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return { userId: result.user.id, token: result.token };
}

function attemptConnect(port: number, bandId: string, token: string): Promise<'connected' | 'rejected'> {
  return new Promise((resolve) => {
    const config: ConstructorParameters<typeof HocuspocusProvider>[0] & { WebSocketPolyfill?: unknown } = {
      url: `ws://localhost:${port}`,
      name: bandId,
      document: new Y.Doc(),
      token,
      onAuthenticationFailed: () => {
        provider.destroy();
        resolve('rejected');
      },
      onSynced: () => {
        provider.destroy();
        resolve('connected');
      },
    };
    // `HocuspocusProvider`'s type doesn't declare `WebSocketPolyfill` for the
    // plain-`url` constructor form (only `HocuspocusProviderWebsocket`'s
    // config type does) — but at runtime, giving it a `url` makes it
    // construct its own internal HocuspocusProviderWebsocket from this same
    // object, so the field is still forwarded and honored. Node has no
    // native WebSocket global for the library's default to fall back on,
    // hence needing `ws` here at all.
    config.WebSocketPolyfill = WebSocket;
    const provider = new HocuspocusProvider(config);
  });
}

describe('Hocuspocus onAuthenticate (integration)', () => {
  const cleanupUserIds: string[] = [];
  let cleanupBandId: string | undefined;

  beforeAll(async () => {
    await hocuspocusServer.listen();
  });

  afterAll(async () => {
    await hocuspocusServer.destroy();
    if (cleanupBandId) await db.delete(bands).where(eq(bands.id, cleanupBandId));
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  it('accepts a real band member and rejects a non-member, over a real WebSocket', async () => {
    const member = await signUpTestUser();
    const outsider = await signUpTestUser();
    cleanupUserIds.push(member.userId, outsider.userId);

    const [band] = await db
      .insert(bands)
      .values({ name: 'HP Auth Test Band', slug: `hp-auth-test-${randomUUID()}` })
      .returning();
    if (!band) throw new Error('Setup insert returned no row');
    cleanupBandId = band.id;

    await db
      .insert(bandMembers)
      .values({ bandId: band.id, userId: member.userId, role: 'member', instruments: [] });

    const port = hocuspocusServer.configuration.port;
    if (!port) throw new Error('Hocuspocus server has no port configured');
    const [memberResult, outsiderResult] = await Promise.all([
      attemptConnect(port, band.id, member.token),
      attemptConnect(port, band.id, outsider.token),
    ]);

    expect(memberResult).toBe('connected');
    expect(outsiderResult).toBe('rejected');
  }, 15000);
});
