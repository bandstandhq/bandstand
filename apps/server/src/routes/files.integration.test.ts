// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Real Postgres + a real MinIO (see docker/compose.yml locally, or CI's
// integration job), exercised through the actual REST routes. The key
// property under test isn't just "the endpoints return the right status
// codes" — it's that a presigned upload/download round-trips real bytes,
// and that the server actually re-verifies the hash of what landed in the
// bucket rather than trusting the client's claim (docs/adr/0007).
import { randomUUID } from 'node:crypto';
import { sha256Hex } from '@bandstand/core';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../app';
import { db } from '../db/client';
import { attachments, bandMembers, bands, users } from '../db/schema/index';
import { auth } from '../lib/auth';
import { headObject } from '../lib/storage';

async function signUpTestUser() {
  const email = `test-files-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'Files Tester' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return { userId: result.user.id, token: result.token };
}

function req(path: string, method: string, token: string, body?: unknown) {
  return app.request(`/bands${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

// Registers every user/band it creates for cleanup itself — a caller that
// only destructures the fields it needs (e.g. `{ band, member }`) used to
// also have to remember to separately push every id it got back into
// cleanupUserIds/cleanupBandIds, and most call sites here forgot `outsider`
// (see issue for the accumulated leak this caused). Taking the arrays as
// parameters and pushing internally makes that impossible to forget again.
async function setupBand(cleanupUserIds: string[], cleanupBandIds: string[]) {
  const member = await signUpTestUser();
  const outsider = await signUpTestUser();

  const [band] = await db
    .insert(bands)
    .values({ name: 'Files Test Band', slug: `test-files-test-${randomUUID()}` })
    .returning();
  if (!band) throw new Error('Setup insert returned no row');
  cleanupUserIds.push(member.userId, outsider.userId);
  cleanupBandIds.push(band.id);

  await db.insert(bandMembers).values([{ bandId: band.id, userId: member.userId, role: 'member', instruments: [] }]);

  return { band, member, outsider };
}

describe('band file uploads (integration)', () => {
  const cleanupUserIds: string[] = [];
  const cleanupBandIds: string[] = [];

  afterAll(async () => {
    for (const bandId of cleanupBandIds) await db.delete(bands).where(eq(bands.id, bandId));
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  it('rejects a non-member entirely', async () => {
    const { band, outsider } = await setupBand(cleanupUserIds, cleanupBandIds);

    const res = await req(`/${band.id}/files/check`, 'POST', outsider.token, { sha256: 'a'.repeat(64) });
    expect(res.status).toBe(403);
  });

  it('round-trips a real upload: check (miss) -> presign -> PUT -> confirm -> check (hit) -> presign-download -> GET', async () => {
    const { band, member } = await setupBand(cleanupUserIds, cleanupBandIds);

    const content = Buffer.from(`test file content ${randomUUID()}`);
    const sha256 = await sha256Hex(content);

    const missCheck = await req(`/${band.id}/files/check`, 'POST', member.token, { sha256 });
    expect(await missCheck.json()).toEqual({ exists: false });

    const presign = await req(`/${band.id}/files/presign-upload`, 'POST', member.token, {
      sha256,
      filename: 'part.pdf',
      mime: 'application/pdf',
      size: content.byteLength,
    });
    expect(presign.status).toBe(200);
    const { uploadUrl } = (await presign.json()) as { uploadUrl: string };

    const putRes = await fetch(uploadUrl, { method: 'PUT', body: content, headers: { 'Content-Type': 'application/pdf' } });
    expect(putRes.status).toBe(200);

    const confirm = await req(`/${band.id}/files/confirm`, 'POST', member.token, {
      sha256,
      filename: 'part.pdf',
      mime: 'application/pdf',
      size: content.byteLength,
    });
    expect(confirm.status).toBe(200);

    const hitCheck = await req(`/${band.id}/files/check`, 'POST', member.token, { sha256 });
    expect(await hitCheck.json()).toEqual({ exists: true });

    const presignDownload = await req(`/${band.id}/files/${sha256}/presign-download`, 'GET', member.token);
    expect(presignDownload.status).toBe(200);
    const { downloadUrl } = (await presignDownload.json()) as { downloadUrl: string };

    const getRes = await fetch(downloadUrl);
    const downloaded = Buffer.from(await getRes.arrayBuffer());
    expect(downloaded.equals(content)).toBe(true);

    const [ledgerRow] = await db
      .select({ filename: attachments.filename, uploadedBy: attachments.uploadedBy })
      .from(attachments)
      .where(eq(attachments.sha256, sha256));
    expect(ledgerRow).toMatchObject({ filename: 'part.pdf', uploadedBy: member.userId });
  });

  it('rejects presign-download for a hash this band never uploaded', async () => {
    const { band, member } = await setupBand(cleanupUserIds, cleanupBandIds);

    const res = await req(`/${band.id}/files/${'b'.repeat(64)}/presign-download`, 'GET', member.token);
    expect(res.status).toBe(404);
  });

  it('rejects an unsupported mime type before issuing a presigned URL', async () => {
    const { band, member } = await setupBand(cleanupUserIds, cleanupBandIds);

    const res = await req(`/${band.id}/files/presign-upload`, 'POST', member.token, {
      sha256: 'c'.repeat(64),
      filename: 'macro.exe',
      mime: 'application/x-msdownload',
      size: 100,
    });
    expect(res.status).toBe(415);
  });

  it('rejects a file over the configured size limit before issuing a presigned URL', async () => {
    const { band, member } = await setupBand(cleanupUserIds, cleanupBandIds);

    const res = await req(`/${band.id}/files/presign-upload`, 'POST', member.token, {
      sha256: 'd'.repeat(64),
      filename: 'huge.pdf',
      mime: 'application/pdf',
      size: 999_999_999_999,
    });
    expect(res.status).toBe(413);
  });

  it('rejects a second band confirming a hash the first band actually uploaded, without a presign-upload call of its own', async () => {
    const bandA = await setupBand(cleanupUserIds, cleanupBandIds);
    const bandB = await setupBand(cleanupUserIds, cleanupBandIds);

    const content = Buffer.from(`band A's exclusive content ${randomUUID()}`);
    const sha256 = await sha256Hex(content);

    const presign = await req(`/${bandA.band.id}/files/presign-upload`, 'POST', bandA.member.token, {
      sha256,
      filename: 'exclusive.pdf',
      mime: 'application/pdf',
      size: content.byteLength,
    });
    const { uploadUrl } = (await presign.json()) as { uploadUrl: string };
    await fetch(uploadUrl, { method: 'PUT', body: content, headers: { 'Content-Type': 'application/pdf' } });
    const confirmA = await req(`/${bandA.band.id}/files/confirm`, 'POST', bandA.member.token, {
      sha256,
      filename: 'exclusive.pdf',
      mime: 'application/pdf',
      size: content.byteLength,
    });
    expect(confirmA.status).toBe(200);

    // The attack: band B knows the hash (e.g. one of its members is also in
    // band A) and calls /confirm directly against its own band, without
    // ever calling presign-upload — the old bug accepted this, since the
    // object already existed at that content-addressed key.
    const confirmB = await req(`/${bandB.band.id}/files/confirm`, 'POST', bandB.member.token, {
      sha256,
      filename: 'stolen.pdf',
      mime: 'application/pdf',
      size: content.byteLength,
    });
    expect(confirmB.status).toBe(403);

    const [ledgerRow] = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.bandId, bandB.band.id), eq(attachments.sha256, sha256)));
    expect(ledgerRow).toBeUndefined();
  });

  it("rejects confirm even after the band's own presign-upload call, when the object predates it", async () => {
    const bandA = await setupBand(cleanupUserIds, cleanupBandIds);
    const bandB = await setupBand(cleanupUserIds, cleanupBandIds);

    const content = Buffer.from(`band A's older content ${randomUUID()}`);
    const sha256 = await sha256Hex(content);

    const presignA = await req(`/${bandA.band.id}/files/presign-upload`, 'POST', bandA.member.token, {
      sha256,
      filename: 'older.pdf',
      mime: 'application/pdf',
      size: content.byteLength,
    });
    const { uploadUrl } = (await presignA.json()) as { uploadUrl: string };
    await fetch(uploadUrl, { method: 'PUT', body: content, headers: { 'Content-Type': 'application/pdf' } });
    await req(`/${bandA.band.id}/files/confirm`, 'POST', bandA.member.token, {
      sha256,
      filename: 'older.pdf',
      mime: 'application/pdf',
      size: content.byteLength,
    });

    // The attack, refined: band B does call presign-upload for the same
    // hash first (getting a real "pending" row), but never actually PUTs
    // anything — the object at that key still predates band B's own
    // presign call, so /confirm must still reject it.
    await req(`/${bandB.band.id}/files/presign-upload`, 'POST', bandB.member.token, {
      sha256,
      filename: 'stolen.pdf',
      mime: 'application/pdf',
      size: content.byteLength,
    });
    const confirmB = await req(`/${bandB.band.id}/files/confirm`, 'POST', bandB.member.token, {
      sha256,
      filename: 'stolen.pdf',
      mime: 'application/pdf',
      size: content.byteLength,
    });
    expect(confirmB.status).toBe(403);

    const [ledgerRow] = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.bandId, bandB.band.id), eq(attachments.sha256, sha256)));
    expect(ledgerRow).toBeUndefined();
  });

  it('rejects confirm when the uploaded bytes do not match the claimed hash, and removes the object', async () => {
    const { band, member } = await setupBand(cleanupUserIds, cleanupBandIds);

    const realContent = Buffer.from(`real content ${randomUUID()}`);
    const claimedSha256 = await sha256Hex(Buffer.from(`different content entirely ${randomUUID()}`));

    const presign = await req(`/${band.id}/files/presign-upload`, 'POST', member.token, {
      sha256: claimedSha256,
      filename: 'tampered.pdf',
      mime: 'application/pdf',
      size: realContent.byteLength,
    });
    const { uploadUrl } = (await presign.json()) as { uploadUrl: string };
    await fetch(uploadUrl, { method: 'PUT', body: realContent, headers: { 'Content-Type': 'application/pdf' } });

    const confirm = await req(`/${band.id}/files/confirm`, 'POST', member.token, {
      sha256: claimedSha256,
      filename: 'tampered.pdf',
      mime: 'application/pdf',
      size: realContent.byteLength,
    });
    expect(confirm.status).toBe(422);

    const [ledgerRow] = await db.select().from(attachments).where(eq(attachments.sha256, claimedSha256));
    expect(ledgerRow).toBeUndefined();

    const downloadAttempt = await req(`/${band.id}/files/${claimedSha256}/presign-download`, 'GET', member.token);
    expect(downloadAttempt.status).toBe(404);
  });

  // Regression tests for docs/adr/0015-staged-uploads.md: a presigned PUT
  // used to target the shared, cross-band `blobs/<sha256>` key directly, so
  // any band that knew a victim band's hash could overwrite its content
  // outright, and a mismatched /confirm's old cleanup step would delete the
  // victim's object entirely. Both now only ever touch this band's own
  // band-scoped staging object.
  it("an attacker band cannot overwrite a victim band's blob by presigning and PUTting different bytes at its hash", async () => {
    const victim = await setupBand(cleanupUserIds, cleanupBandIds);
    const attacker = await setupBand(cleanupUserIds, cleanupBandIds);

    const realContent = Buffer.from(`victim's real content ${randomUUID()}`);
    const sha256 = await sha256Hex(realContent);

    const presignVictim = await req(`/${victim.band.id}/files/presign-upload`, 'POST', victim.member.token, {
      sha256,
      filename: 'real.pdf',
      mime: 'application/pdf',
      size: realContent.byteLength,
    });
    const { uploadUrl: victimUploadUrl } = (await presignVictim.json()) as { uploadUrl: string };
    await fetch(victimUploadUrl, { method: 'PUT', body: realContent, headers: { 'Content-Type': 'application/pdf' } });
    const confirmVictim = await req(`/${victim.band.id}/files/confirm`, 'POST', victim.member.token, {
      sha256,
      filename: 'real.pdf',
      mime: 'application/pdf',
      size: realContent.byteLength,
    });
    expect(confirmVictim.status).toBe(200);

    // The attacker doesn't have the victim's real bytes — only the hash
    // (e.g. from a repertoire export) — so it PUTs arbitrary substitute
    // content, claiming the victim's hash.
    const substituteContent = Buffer.from(`attacker's substitute content ${randomUUID()}`);
    const presignAttacker = await req(`/${attacker.band.id}/files/presign-upload`, 'POST', attacker.member.token, {
      sha256,
      filename: 'substitute.pdf',
      mime: 'application/pdf',
      size: substituteContent.byteLength,
    });
    const { uploadUrl: attackerUploadUrl } = (await presignAttacker.json()) as { uploadUrl: string };
    await fetch(attackerUploadUrl, { method: 'PUT', body: substituteContent, headers: { 'Content-Type': 'application/pdf' } });
    const confirmAttacker = await req(`/${attacker.band.id}/files/confirm`, 'POST', attacker.member.token, {
      sha256,
      filename: 'substitute.pdf',
      mime: 'application/pdf',
      size: substituteContent.byteLength,
    });
    // The attacker's own staged bytes don't actually hash to the claimed
    // (victim's) hash, so this fails exactly like any other tampered
    // upload — never a special case for "someone else already has this".
    expect(confirmAttacker.status).toBe(422);

    const [attackerLedgerRow] = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.bandId, attacker.band.id), eq(attachments.sha256, sha256)));
    expect(attackerLedgerRow).toBeUndefined();

    // The victim's own blob is completely untouched — still there, still
    // exactly the original bytes.
    const presignDownload = await req(`/${victim.band.id}/files/${sha256}/presign-download`, 'GET', victim.member.token);
    expect(presignDownload.status).toBe(200);
    const { downloadUrl } = (await presignDownload.json()) as { downloadUrl: string };
    const getRes = await fetch(downloadUrl);
    const downloaded = Buffer.from(await getRes.arrayBuffer());
    expect(downloaded.equals(realContent)).toBe(true);
  });

  it("a failed confirm never deletes the shared blob another band's ledger still points at", async () => {
    const victim = await setupBand(cleanupUserIds, cleanupBandIds);
    const attacker = await setupBand(cleanupUserIds, cleanupBandIds);

    const realContent = Buffer.from(`another victim's content ${randomUUID()}`);
    const sha256 = await sha256Hex(realContent);

    const presignVictim = await req(`/${victim.band.id}/files/presign-upload`, 'POST', victim.member.token, {
      sha256,
      filename: 'real.pdf',
      mime: 'application/pdf',
      size: realContent.byteLength,
    });
    const { uploadUrl: victimUploadUrl } = (await presignVictim.json()) as { uploadUrl: string };
    await fetch(victimUploadUrl, { method: 'PUT', body: realContent, headers: { 'Content-Type': 'application/pdf' } });
    await req(`/${victim.band.id}/files/confirm`, 'POST', victim.member.token, {
      sha256,
      filename: 'real.pdf',
      mime: 'application/pdf',
      size: realContent.byteLength,
    });
    const before = await headObject(sha256);
    expect(before).not.toBeNull();

    const presignAttacker = await req(`/${attacker.band.id}/files/presign-upload`, 'POST', attacker.member.token, {
      sha256,
      filename: 'substitute.pdf',
      mime: 'application/pdf',
      size: 5,
    });
    const { uploadUrl: attackerUploadUrl } = (await presignAttacker.json()) as { uploadUrl: string };
    await fetch(attackerUploadUrl, { method: 'PUT', body: Buffer.from('bogus'), headers: { 'Content-Type': 'application/pdf' } });
    const confirmAttacker = await req(`/${attacker.band.id}/files/confirm`, 'POST', attacker.member.token, {
      sha256,
      filename: 'substitute.pdf',
      mime: 'application/pdf',
      size: 5,
    });
    expect(confirmAttacker.status).toBe(422);

    // The shared object is still exactly as it was — never even briefly
    // deleted (the old bug's `deleteObject` call, before the staging
    // indirection, operated on this exact shared key).
    const after = await headObject(sha256);
    expect(after).not.toBeNull();
    expect(after?.size).toBe(before?.size);
  });

  it('lets two different bands each confirm an upload of the exact same bytes — dedup still works', async () => {
    const bandA = await setupBand(cleanupUserIds, cleanupBandIds);
    const bandB = await setupBand(cleanupUserIds, cleanupBandIds);

    const sharedContent = Buffer.from(`shared arrangement ${randomUUID()}`);
    const sha256 = await sha256Hex(sharedContent);

    for (const { band, member } of [bandA, bandB]) {
      const presign = await req(`/${band.id}/files/presign-upload`, 'POST', member.token, {
        sha256,
        filename: 'shared.pdf',
        mime: 'application/pdf',
        size: sharedContent.byteLength,
      });
      const { uploadUrl } = (await presign.json()) as { uploadUrl: string };
      await fetch(uploadUrl, { method: 'PUT', body: sharedContent, headers: { 'Content-Type': 'application/pdf' } });
      const confirm = await req(`/${band.id}/files/confirm`, 'POST', member.token, {
        sha256,
        filename: 'shared.pdf',
        mime: 'application/pdf',
        size: sharedContent.byteLength,
      });
      expect(confirm.status).toBe(200);

      const [ledgerRow] = await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.bandId, band.id), eq(attachments.sha256, sha256)));
      expect(ledgerRow).toBeDefined();

      const presignDownload = await req(`/${band.id}/files/${sha256}/presign-download`, 'GET', member.token);
      const { downloadUrl } = (await presignDownload.json()) as { downloadUrl: string };
      const getRes = await fetch(downloadUrl);
      const downloaded = Buffer.from(await getRes.arrayBuffer());
      expect(downloaded.equals(sharedContent)).toBe(true);
    }
  });
});
