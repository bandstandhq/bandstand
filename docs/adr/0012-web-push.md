# ADR-0012: Web push — no Firebase, event/poll creation observed off the shared doc, never notifying yourself

## Context

Bands wanted a nudge when something changes on their calendar — a new gig gets booked, a rehearsal
moves, someone opens a scheduling poll, or a date is coming up and you haven't said whether you can
make it. Bandstand is self-hostable with no dependency on a third-party account (see
`docs/SELF_HOSTING.md`), so push had to work without Firebase Cloud Messaging or any other vendor
account — the Web Push standard (VAPID + the browser's own push service) is the only mechanism that
fits.

Two things needed a decision beyond a code comment: where server code actually observes "an event
was created," given ordinary event/poll creation is a plain collaborative CRDT write with no REST
route in front of it; and how the two time-based reminders avoid re-sending themselves on every run
of an hourly cron job.

## Decision

### Observed off the shared Yjs doc's `onChange`, not a REST route

Every other push-worthy action in this app (song delete-forever, setlist delete) is server-mediated
through a REST route specifically because it's destructive and needs a permission check beyond what
the CRDT layer itself expresses (see ADR-0005). Creating or editing an event, or creating a poll, is
not that — it's an ordinary collaborative edit straight into the band's Yjs document, the same way
adding a song or reordering a setlist is, with no server route involved at all.

That means the only place server code ever sees "a new event just appeared" is `hocuspocus.ts`'s
`onChange` hook — the same hook that already keeps a before/after snapshot to guard `songs`/
`voices`/`setlists` deletion and `availability`/`pollVotes` ownership. Push notifications reuse that
pattern with their own snapshot: `events`/`polls` before and after each change, diffed for new keys
(`eventCreated`, `pollCreated`) and changed values on an existing key (`eventChanged` — an edit or a
cancellation of an event someone's already been told about). A new key that shares a `seriesId` with
an entry that already existed is treated as `eventChanged`, not `eventCreated`: from a user's point
of view, an exception on a series they already know about is a change to something familiar, not a
brand new event.

The send itself is fire-and-forget from inside `onChange` — a slow or failing push service must
never delay or break the actual document sync/persistence this hook is otherwise responsible for.

One known gap: a poll closed into an event via `POST /bands/:bandId/polls/:pollId/close` (the one
event-creating path that _is_ a REST route, since closing a poll is destructive/admin-mediated) goes
through `withBandDoc`'s server-side direct connection, which has no real authenticated user attached
to its write. The resulting `eventCreated` push can't be attributed to "whoever closed the poll" and
so isn't excluded from it — the admin who closed the poll gets notified about the event they just
created. Acceptable for now; fixing it would mean threading the closing admin's id through
`withBandDoc` for this one case.

### A user's own action never notifies them

`sendPushToUsers` takes an explicit `excludeUserId` and never sends to it. For the doc-observed
triggers that's the acting connection's own `userId` from Hocuspocus's `context`; for the two
reminders (below) there is no "actor" at all, so exclusion doesn't apply — a reminder is inherently
about the recipient's own inaction, never something someone else just did.

### Five triggers, all off by default, one preference row per user

`user_prefs.pushTriggers` holds five independent booleans — `eventCreated`, `eventChanged`,
`pollCreated`, `missingResponseReminder`, `upcomingEventReminder` — all defaulting to `false`. Push
is opt-in; nothing is ever sent until a person has both subscribed a device and turned a specific
trigger on. `PATCH /push/prefs` takes one `{trigger, enabled}` pair at a time rather than accepting
a partial `pushTriggers` object, so flipping one trigger can never accidentally reset the other four
to whatever an out-of-date client happened to send.

### The two reminders run from a script, deduped by a small log table, not stored state on the event

`missingResponseReminder` (an event ~3 days out this member hasn't answered) and
`upcomingEventReminder` (an event about an hour away) are time-based, not doc-change-based — nothing
"happens" to trigger them, time just passes. They're computed by `pnpm push:due`
(`apps/server/src/push/due.ts`), meant to run hourly via cron (see `docs/SELF_HOSTING.md`), scanning
every band's persisted snapshot for occurrences entering either window.

Running hourly against a window the same width as the cron interval means a given occurrence enters
each window exactly once, but a rerun within that same hour (a retry, or overlapping cron
invocations) would still resend without a dedup mechanism. `push_reminder_log` is that mechanism —
one row per `(userId, reminderKey)`, `reminderKey` being `<type>:<occurrenceId>`, with a primary key
that IS the uniqueness constraint. The check is "does this row already exist," not any timestamp
comparison — simpler than reasoning about exact window boundaries a second time, and correct
regardless of how many times the script gets re-run for the same hour.

### Sending goes through an injectable interface, so tests never touch a real push service

`push/send.ts`'s `PushSender` interface wraps `web-push`'s `sendNotification` behind one method;
`setPushSenderForTesting` swaps in a fake for the whole test process. Every test that exercises a
real send path (trigger-preference checks, self-exclusion, expired-subscription cleanup on a 404/410
response, the reminder dedup) does so against this fake, never a real endpoint — matching the same
"real proof, not a mock of the thing that matters" bar as the tampered-hash/permission-guard
integration tests elsewhere.

### No Firebase Cloud Messaging, no vendor account

Every browser's own push service (whichever that is per-browser — this is the entire point of the
Web Push standard) is used directly via VAPID key-pair authentication, generated once with
`pnpm push:keys` and never rotated automatically (rotating would silently invalidate every existing
subscription). A self-hoster who never runs that command gets a server that starts and works
normally — `hasVapidKeys()` gates every send path, and a missing pair logs one notice at boot, not
per request.

### iOS Safari's limitation is real and stated plainly, not hidden

Push notifications on iOS/iPadOS only work for a web app added to the Home Screen, on Safari 16.4+
— a plain browser tab, no matter how the permission prompt is answered, never receives them. The
Settings panel says this inline, next to the enable toggle, rather than leaving someone to discover
it by a notification simply never arriving.

## Consequences

- Any future action that should trigger a push and _does_ go through a REST route (a genuinely new
  destructive/admin-mediated operation) should call `push/send.ts` directly from that route, the way
  poll-close's event creation does implicitly via the doc-diff — not be forced through the
  doc-diffing path that events/polls currently rely on only because they have no route of their own.
- Adding a sixth trigger means extending `pushTriggersSchema` (a breaking-ish schema change, though
  additive fields default safely) and deciding whether it belongs in the doc-diff observer or the
  `push:due` script, depending on whether it's event-driven or time-driven.
