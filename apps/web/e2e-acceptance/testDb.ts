// SPDX-License-Identifier: Apache-2.0
//
// Direct Postgres access for test setup/teardown that has no REST
// equivalent (there's no "remove a band member" endpoint yet) — mirrors
// the pattern apps/server's own *.integration.test.ts files use, just from
// the web workspace since that's where these acceptance specs live.
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://bandstand:bandstand@localhost:5432/bandstand';

export async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function getBandIdBySlug(client: Client, slug: string): Promise<string> {
  const { rows } = await client.query('select id from bands where slug = $1', [slug]);
  if (!rows[0]) throw new Error(`No band with slug "${slug}"`);
  return rows[0].id as string;
}

export async function getUserIdByEmail(client: Client, email: string): Promise<string> {
  const { rows } = await client.query('select id from users where email = $1', [email]);
  if (!rows[0]) throw new Error(`No user with email "${email}"`);
  return rows[0].id as string;
}

export async function addBandMember(client: Client, bandId: string, userId: string): Promise<void> {
  await client.query(
    `insert into band_members (band_id, user_id, role, instruments)
     values ($1, $2, 'member', $3)
     on conflict do nothing`,
    [bandId, userId, []],
  );
}

export async function removeBandMember(client: Client, bandId: string, userId: string): Promise<void> {
  await client.query('delete from band_members where band_id = $1 and user_id = $2', [bandId, userId]);
}

/** Reads a setlist's id out of the band doc's stored snapshot (see packages/core/src/yjs/snapshot.ts). */
export async function getSetlistIdByName(client: Client, bandId: string, setlistName: string): Promise<string> {
  const { rows } = await client.query('select snapshot from band_docs where band_id = $1', [bandId]);
  if (!rows[0]) throw new Error(`No band_docs row for band ${bandId}`);
  const snapshot = rows[0].snapshot as { setlists: Record<string, { name: string }> };
  const entry = Object.entries(snapshot.setlists).find(([, s]) => s.name === setlistName);
  if (!entry) throw new Error(`No setlist named "${setlistName}" in band ${bandId}`);
  return entry[0];
}
