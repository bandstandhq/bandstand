# ADR-0011: Calendar events — recurrence as a rule, availability by concrete occurrence, and an unauthenticated ICS feed

## Context

Bandstand's bands were coordinating gigs and rehearsals over WhatsApp threads — no shared source of
truth for "when," no record of who could actually make it, and no way to get a date onto a
musician's own phone calendar without manual re-entry. Milestone 3 gives every band a shared
calendar (events, availability, scheduling polls) living in the same offline-first Yjs document as
songs and setlists, plus a read-only ICS subscription feed so a person's phone calendar app can pick
these dates up on its own.

Four decisions here needed more than a schema comment to explain safely: how a recurring event is
stored without ever materializing "one row per date," how a specific occurrence's availability is
addressed once "the date" and "the entry" aren't always the same thing, how "always your own answer,
never someone else's" is enforced when there's no REST route in front of the edit to check a role
against, and what a public, token-authenticated feed is and isn't allowed to trust.

## Decision

### A series is a template plus exceptions, never one entry per generated date

The `events` Y.Map's first occurrence of a recurring event is the **template**: it carries
`seriesId` equal to its own key and a `seriesRule: {freq, until?}`. Every other occurrence is
resolved at read time by `resolveEventOccurrences` (`packages/core/src/yjs/eventSeries.ts`) walking
the rule forward from the template's own `startsAt`. An **exception** — one date's override or
cancellation — is a separate, real `events` entry carrying the same `seriesId` plus an
`occurrenceDate` (the generated date it replaces); the resolver checks for a matching
`(seriesId, occurrenceDate)` exception at each generated date before synthesizing a virtual one, and
a `status: 'cancelled'` exception suppresses that date entirely without touching the series itself.
Nothing about the template is ever mutated to represent "this one date is different" — that would
make the template ambiguous about which date it actually describes.

### A recurring series has a hard expansion cap, independent of the caller's own range

`resolveEventOccurrences` cannot trust a caller's requested range to bound how far an `until`-less
rule expands — a wide range (a careless future caller, or simply a self-hosted deployment nobody
audited) against a `freq: weekly` series with no end date must not hang or grow unbounded. The
resolver caps generation at whichever comes first: two years past the later of the caller's own
range start or the series' own `startsAt`, or 200 generated occurrences — enforced *inside* the pure
function, never left as something callers are expected to self-limit. It also jumps directly to the
first in-range occurrence via closed-form date arithmetic (an O(1) estimate, corrected by a small
bounded loop for a calendar month's variable length) rather than walking one interval at a time from
the series' genesis, so a range starting years after an old series began still resolves in
effectively constant time instead of scanning every prior week.

### Availability is addressed by concrete occurrence, not by series

Whether someone can make it on the 14th and not the 21st is real, different information — an
availability answer can never be keyed by a series as a whole. The `availability` map's composite
key is `<occurrenceId>:<userId>`, and `occurrenceId` is one of two shapes: a real `events` key (a
plain event, or an exception) uses its own id directly; a virtual (never materialized) occurrence
uses a synthetic `${templateEventId}@${isoDate}` id, agreed by convention rather than stored
anywhere. This mirrors ADR-0010's page-sync pseudo-anchor technique — a value that only ever needs
to exist as a wire-format key, never as its own document entry — applied here to solve a different
problem (occurrence identity instead of position identity).

### "Always your own answer, never someone else's" is enforced at the CRDT layer

`availability:respond` and `poll:vote` have no permissions-matrix entry at all — every member may
write to these maps, self-scoped, the same "self-always-allowed" shape as `assignment:editOthers`.
But unlike that case, there is no REST route in front of these edits to check a role against: they
are ordinary, real-time collaborative Yjs writes, exactly like editing a song. The only place left to
enforce the "never someone else's key" half of the rule is ADR-0005's existing manipulated-client
guard in `hocuspocus.ts`'s `onChange` hook. **This is an amendment to that guard's scope, not a new
mechanism**: the original guard reverts *whole-key deletion* from `songs`/`voices`/`setlists`; this
ADR adds a second, differently-shaped predicate for the `availability` and `pollVotes` maps
specifically — any inserted, changed, *or* deleted key whose trailing `:<userId>` segment doesn't
match the connecting client's own authenticated userId is reverted to its prior value (or removed,
if it didn't exist before), logged the same way the original guard already logs a reverted deletion.
Proven the same way ADR-0005's own guard was: a real member connection, over a live WebSocket, with
no REST call involved, attempting the exact bypass.

### Destructive, admin-mediated actions stay REST; everything else stays CRDT

Deleting a single event or an entire series, deleting a poll, and closing a poll into a real event
all go through REST via `withBandDoc` — the same `song:deleteForever`/`setlist:delete` shape ADR-0005
established. Closing a poll is one `withBandDoc` transaction that both creates the winning option's
event and marks the poll resolved, so a poll can never be left pointing at an event that doesn't
exist or get resolved twice under a race. Creating and editing events/polls, responding to
availability, and voting all stay plain CRDT, open to every member (creation/editing admin-gated by
the matrix; responding/voting self-scoped as above) — there's nothing about them that needs a
server-mediated guarantee beyond what the ownership guard already provides.

### The ICS feed rechecks membership on every single request, and says so out loud

A subscription URL has no expiry, and calendar apps cache and re-poll it indefinitely — including
long after the person may have left every band that URL could ever have covered. The **only**
correct membership check is therefore "which bands does this userId belong to *right now*," queried
fresh from Postgres on every `GET /calendar/:token.ics`, never a cached or precomputed list resolved
once when the token was issued. This is called out explicitly here so a future performance pass
never "optimizes" it into a cached join without realizing that would silently reopen access for a
removed member.

Because the feed aggregates *every* band the token's user is in, with locations included, a leaked
or over-shared link is a real, standing exposure — not a theoretical one — for as long as the token
stays valid. The Settings panel showing the URL states this plainly, next to the link itself: anyone
holding it can read every event, including location, across all of the user's bands until it's
regenerated. Regenerating (overwriting the stored token) is the only revocation mechanism, since the
token itself never expires on its own.

## Consequences

- `bandSnapshotSchema` gained four flat, composite-key maps (`events`, `availability`, `polls`,
  `pollVotes`), all `.default({})` so every doc written before this milestone still parses
  unchanged — the same back-compat pattern `assignments`/`anchors` established in Milestones 2.
- A cancelled event is always emitted into the ICS feed as `STATUS:CANCELLED`, never omitted — the
  feed has no mechanism to retract an event it already sent, so a subscriber's calendar app needs
  the cancellation notice to remove what it cached.
- The hocuspocus `onChange` guard now has two independent predicates (whole-key-deletion for
  `songs`/`voices`/`setlists`; per-key ownership for `availability`/`pollVotes`) rather than one —
  a third kind of guarded map in the future should get its own clearly-named predicate too, not be
  forced to fit whichever of the first two happens to be closest.
- `findOccurrenceEvent` (`packages/core/src/yjs/eventSeries.ts`) resolves a detail page's occurrence
  id (real or synthetic) back to its effective data by narrowing `resolveEventOccurrences` to just
  that one date — a URL-facing convenience built directly on the same resolver everything else uses,
  never a second parallel implementation of the exception-matching logic.
