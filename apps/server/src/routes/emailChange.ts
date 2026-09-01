// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Hybrid email-change model (see pendingEmailChanges.ts): the change only
// takes effect once the NEW address confirms; the OLD address only gets a
// notice with a cancel link, never a required confirmation of its own.
// `/confirm` and `/cancel` are deliberately unauthenticated — the random
// token mailed out is itself the credential, same shape as better-auth's
// own password-reset link, since the person clicking it is very often not
// currently signed in on that device/browser at all.
import { randomBytes } from 'node:crypto';
import {
  cancelEmailChangeInputSchema,
  confirmEmailChangeInputSchema,
  requestEmailChangeInputSchema,
} from '@bandstand/core';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { pendingEmailChanges, users } from '../db/schema/index';
import type { AuthVariables } from '../lib/bandAuthz';
import { requireAuth } from '../lib/bandAuthz';
import { parseAllowedOrigins } from '../lib/corsOrigins';
import { isUniqueViolation } from '../lib/pgErrors';
import { sendMail } from '../lib/mailer';

const EMAIL_CHANGE_EXPIRY_MS = 24 * 60 * 60 * 1000;

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

function isTrustedOrigin(url: string): boolean {
  const allowed = new Set(parseAllowedOrigins(process.env.WEB_ORIGIN));
  try {
    return allowed.has(new URL(url).origin);
  } catch {
    return false;
  }
}

export const emailChangeRoute = new Hono<{ Variables: AuthVariables }>();

emailChangeRoute.post('/', requireAuth, async (c) => {
  const userId = c.get('userId');
  const { newEmail, confirmUrl, cancelUrl } = requestEmailChangeInputSchema.parse(await c.req.json());

  // A compromised session could otherwise point the old-address notice
  // email's cancel link at a phishing domain, abusing Bandstand's own
  // legitimate sender as bait — see emailChange.ts's schema comment.
  if (!isTrustedOrigin(confirmUrl) || !isTrustedOrigin(cancelUrl)) {
    return c.json({ error: 'confirmUrl/cancelUrl must be on a trusted origin' }, 400);
  }

  const [currentUser] = await db.select().from(users).where(eq(users.id, userId));
  if (!currentUser) return c.json({ error: 'Unauthorized' }, 401);

  const newEmailNormalized = newEmail.toLowerCase();
  if (newEmailNormalized === currentUser.email) {
    return c.json({ error: 'That is already your email address' }, 400);
  }

  // Same enumeration-avoidance convention as signup (see SignupForm.tsx):
  // whether or not newEmail already belongs to someone else, the response
  // is identical — only whether anything actually gets sent differs.
  const [alreadyTaken] = await db.select({ id: users.id }).from(users).where(eq(users.email, newEmailNormalized));
  if (!alreadyTaken) {
    const confirmToken = generateToken();
    const cancelToken = generateToken();
    const expiresAt = new Date(Date.now() + EMAIL_CHANGE_EXPIRY_MS);

    await db
      .insert(pendingEmailChanges)
      .values({ userId, oldEmail: currentUser.email, newEmail: newEmailNormalized, confirmToken, cancelToken, expiresAt })
      .onConflictDoUpdate({
        target: pendingEmailChanges.userId,
        set: { oldEmail: currentUser.email, newEmail: newEmailNormalized, confirmToken, cancelToken, createdAt: new Date(), expiresAt },
      });

    await sendMail(
      newEmailNormalized,
      'Confirm your new Bandstand email address',
      `<p>Click <a href="${confirmUrl}?token=${confirmToken}">here</a> to make this your Bandstand account's email address. If you didn't request this, ignore this email.</p>`,
    );
    await sendMail(
      currentUser.email,
      'Your Bandstand email address is changing',
      `<p>Someone requested to change your Bandstand account's email address to ${newEmailNormalized}. If this wasn't you, <a href="${cancelUrl}?token=${cancelToken}">click here to cancel it</a>. Otherwise, no action is needed — the change only takes effect once the new address confirms it.</p>`,
    );
  }

  return c.json({ status: true });
});

emailChangeRoute.post('/confirm', async (c) => {
  const { token } = confirmEmailChangeInputSchema.parse(await c.req.json());

  const [pending] = await db.select().from(pendingEmailChanges).where(eq(pendingEmailChanges.confirmToken, token));
  if (!pending || pending.expiresAt < new Date()) {
    return c.json({ error: 'This confirmation link is invalid or has expired' }, 400);
  }

  try {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ email: pending.newEmail, emailVerified: true }).where(eq(users.id, pending.userId));
      await tx.delete(pendingEmailChanges).where(eq(pendingEmailChanges.userId, pending.userId));
    });
  } catch (err) {
    // Someone else registered pending.newEmail between the original request
    // and this confirmation — the unique constraint on users.email is the
    // real backstop here, this just turns it into a clean 409.
    if (isUniqueViolation(err)) {
      return c.json({ error: 'That email address was taken by another account in the meantime' }, 409);
    }
    throw err;
  }

  return c.json({ email: pending.newEmail });
});

emailChangeRoute.post('/cancel', async (c) => {
  const { token } = cancelEmailChangeInputSchema.parse(await c.req.json());

  const [pending] = await db.select().from(pendingEmailChanges).where(eq(pendingEmailChanges.cancelToken, token));
  if (!pending) {
    return c.json({ error: 'This cancellation link is invalid or has already been used' }, 400);
  }

  await db.delete(pendingEmailChanges).where(eq(pendingEmailChanges.userId, pending.userId));
  return c.json({ status: true });
});
