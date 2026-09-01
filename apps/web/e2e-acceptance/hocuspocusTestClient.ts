// SPDX-License-Identifier: Apache-2.0
//
// A direct, non-UI Hocuspocus connection for scenarios where driving the
// actual drag-and-drop UI would test dnd-kit's mouse-event handling rather
// than the thing the scenario cares about: whether two concurrent, real
// WebSocket clients merge without losing either edit. Mirrors
// apps/server/src/lib/hocuspocus.integration.test.ts's pattern from the
// server side.
import { HocuspocusProvider } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';

const SERVER_URL = process.env.VITE_DEFAULT_SERVER_URL ?? 'http://localhost:3001';
const HOCUSPOCUS_URL = process.env.VITE_DEFAULT_HOCUSPOCUS_URL ?? 'ws://localhost:3002';

export async function signInForToken(email: string, password: string): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:4173' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Sign-in failed with status ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error('Sign-in response had no token');
  return body.token;
}

/**
 * Creates a brand-new real account with a chosen display name and returns
 * its session token — for scenarios that need several distinctly-named,
 * genuinely separate users (e.g. proving a member-list sort order) rather
 * than reusing the seeded demo accounts. `email` must carry the `test-`
 * prefix (see fixtures.ts's `freshEmail`) so cleanup scripts recognize it.
 */
export async function signUpForToken(name: string, email: string, password: string): Promise<{ userId: string; token: string }> {
  const res = await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:4173' },
    body: JSON.stringify({ name, email, password }),
  });
  if (!res.ok) throw new Error(`Sign-up failed with status ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { token?: string; user?: { id?: string } };
  if (!body.token || !body.user?.id) throw new Error('Sign-up response had no token/user id');
  return { userId: body.user.id, token: body.token };
}

export interface TestBandDoc {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  waitForSynced: () => Promise<void>;
}

export function connectTestBandDoc(bandId: string, token: string): TestBandDoc {
  const doc = new Y.Doc();
  let resolveSynced: () => void;
  const syncedOnce = new Promise<void>((resolve) => {
    resolveSynced = resolve;
  });
  const config: ConstructorParameters<typeof HocuspocusProvider>[0] & { WebSocketPolyfill?: unknown } = {
    url: HOCUSPOCUS_URL,
    name: bandId,
    document: doc,
    token,
    onSynced: () => resolveSynced(),
  };
  config.WebSocketPolyfill = WebSocket;
  const provider = new HocuspocusProvider(config);
  return { doc, provider, waitForSynced: () => syncedOnce };
}
