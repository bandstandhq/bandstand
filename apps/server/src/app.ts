// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The fully composed Hono app — routing, middleware, and error handling,
// with no side effects of its own (no listening socket, no Hocuspocus
// startup). Split out of index.ts so integration tests can exercise the
// real request path (`app.request(...)`, going through CORS, the body
// limit, and the global error handler) instead of calling an individual
// route's own sub-router directly, which skips all of that — see the
// August 2026 security review's finding 8 for why that gap mattered in
// practice: a sub-router-only test would never have caught a regression in
// any of this file's own middleware.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { ZodError } from 'zod';
import { auth } from './lib/auth';
import { parseAllowedOrigins } from './lib/corsOrigins';
import { assertWebOriginIsRestricted } from './lib/envGuard';
import { accountActionRateLimit } from './lib/accountActionRateLimit';
import { passwordResetRateLimit } from './lib/passwordResetRateLimit';
import { clientIp, createRateLimiter } from './lib/rateLimit';
import { bandsRoute } from './routes/bands';
import { calendarFeedRoute } from './routes/calendarFeed';
import { health } from './routes/health';
import { icsTokenRoute } from './routes/icsToken';
import { emailChangeRoute } from './routes/emailChange';
import { inviteRedemptionRoute } from './routes/invites';
import { pushRoute } from './routes/push';
import { userPrefsRoute } from './routes/userPrefs';

assertWebOriginIsRestricted(process.env.WEB_ORIGIN);

export const app = new Hono();

// WEB_ORIGIN is a comma-separated list (parseAllowedOrigins) so local dev
// can allow both http://localhost:5173 and a LAN address at once, e.g. for
// testing on a phone (see CONTRIBUTING.md's "Testing on mobile devices"
// section) — never a wildcard, outside NODE_ENV=development/test.
// assertWebOriginIsRestricted (called above) has already aborted startup
// if this doesn't resolve to exactly one real, non-private origin.
app.use(
  '*',
  cors({
    origin: parseAllowedOrigins(process.env.WEB_ORIGIN),
    credentials: true,
  }),
);

// Real file bytes never reach this server (uploads go straight to the
// object store via a presigned URL — see routes/files.ts) — every JSON body
// this API ever legitimately receives is well under a megabyte. 5MB is
// generous headroom over that, not a real per-endpoint limit, but it caps
// how much any single request can make the server buffer before anything
// else runs.
export const MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024;

app.use(
  '*',
  bodyLimit({
    maxSize: MAX_REQUEST_BODY_BYTES,
    onError: (c) => c.json({ error: 'Request body too large' }, 413),
  }),
);

// A schema.parse(await c.req.json()) failing anywhere is a malformed
// request, not a server fault — without this, Hono's default handler
// answers every one of those with a generic 500, indistinguishable from a
// real crash in logs/monitoring. `details` deliberately carries only path
// and error code, never the offending `message`/`received` value some Zod
// issue codes include, so a client probing this endpoint learns what field
// is wrong but not what value the server would have accepted.
app.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json(
      { error: 'Invalid request', details: err.issues.map((issue) => ({ path: issue.path, code: issue.code })) },
      400,
    );
  }
  console.error(err);
  return c.text('Internal Server Error', 500);
});

app.route('/health', health);
app.route('/bands', bandsRoute);
app.route('/invites', inviteRedemptionRoute);
app.route('/me/prefs', userPrefsRoute);
app.route('/me/ics-token', icsTokenRoute);
app.route('/calendar', calendarFeedRoute);
app.route('/push', pushRoute);

// Same layered reasoning as /api/auth/change-password below — an
// already-authenticated caller, no enumeration concern, but a stolen
// session could otherwise hammer this to spam a victim's old inbox or
// probe which addresses are already registered via response timing. Only
// the initiate endpoint (exact path, not /me/email-change/confirm or
// /cancel) needs this — those two are gated by an unguessable mailed
// token instead, the same way a reset-password token itself isn't rate
// limited, only requesting one is.
app.use(
  '/me/email-change',
  accountActionRateLimit({
    name: 'email-change',
    perAccountMax: 5,
    perAccountWindowMs: 60 * 60 * 1000,
    perIpMax: 15,
    perIpWindowMs: 60 * 60 * 1000,
  }),
);
app.route('/me/email-change', emailChangeRoute);

// Registered on this one literal path, ahead of the catch-all below —
// Hono runs matching middleware in registration order, so a reject here
// (an identical-looking success response, see passwordResetRateLimit.ts)
// short-circuits before better-auth's own handler, and therefore its
// mailer call, ever runs.
app.use(
  '/api/auth/request-password-reset',
  passwordResetRateLimit({
    perAccountMax: 3,
    perAccountWindowMs: 60 * 60 * 1000,
    perIpMax: 10,
    perIpWindowMs: 60 * 60 * 1000,
    globalMax: Number(process.env.MAX_PASSWORD_RESET_EMAILS_PER_HOUR ?? 100),
    globalWindowMs: 60 * 60 * 1000,
    dedupeWindowMs: 60 * 1000,
  }),
);

// Registration is fully open (no invite code needed to create an account
// at all, only to join a band) — a genuine account-farming bot is the
// thing this catches, not a real band. That distinction is exactly why
// these thresholds are generous rather than tight: several real members
// signing up together from the same rehearsal-space/home Wi-Fi (one shared
// NAT address) is completely ordinary usage this must not block — a
// mass-signup bot still looks nothing like that even at 20/hour. No
// enumeration/uniformity concern here unlike the password-reset limiter
// above: a plain 429 doesn't reveal anything about who's already
// registered, so the existing `createRateLimiter` is enough, no custom
// response shape needed.
//
// Overridable via env (unlike the other thresholds in this file) because
// the acceptance test suite is itself exactly the kind of "many real
// signups from one shared address in a short window" traffic this is
// meant to tell apart from a bot — every request in one CI job shares a
// single IP, and the suite creates dozens of throwaway accounts in a few
// minutes, comfortably over the production default. This was silently
// failing a chunk of the acceptance suite in CI (whichever specs happened
// to run after the 20th signup) until it was noticed and traced here.
const MAX_SIGNUPS_PER_HOUR = Number(process.env.MAX_SIGNUPS_PER_HOUR ?? 20);
const MAX_SIGNUPS_PER_DAY = Number(process.env.MAX_SIGNUPS_PER_DAY ?? 100);
app.use('/api/auth/sign-up/email', createRateLimiter({ windowMs: 60 * 60 * 1000, max: MAX_SIGNUPS_PER_HOUR })(clientIp));
app.use('/api/auth/sign-up/email', createRateLimiter({ windowMs: 24 * 60 * 60 * 1000, max: MAX_SIGNUPS_PER_DAY })(clientIp));

// Same layered reasoning as request-password-reset above, adapted for an
// already-authenticated caller — see accountActionRateLimit.ts.
app.use(
  '/api/auth/change-password',
  accountActionRateLimit({
    name: 'change-password',
    perAccountMax: 5,
    perAccountWindowMs: 60 * 60 * 1000,
    perIpMax: 15,
    perIpWindowMs: 60 * 60 * 1000,
  }),
);

app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));
