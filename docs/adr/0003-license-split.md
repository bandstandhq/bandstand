# ADR-0003: Split license — Apache-2.0 clients, AGPL-3.0-or-later server

## Context

Bandstand needs to be distributable through app stores (iOS App Store,
Google Play) as a native-feeling client, while also staying protected
against the "someone forks the server, hosts it as a competing SaaS, and
never contributes improvements back" pattern that plain permissive or
weak-copyleft licenses don't prevent.

## Options considered

1. **One license for everything.**
   - All Apache-2.0: simplest, but a hosted fork of `apps/server` could
     ship proprietary improvements with no obligation to share them back.
   - All AGPL-3.0-or-later: closes that loophole, but AGPL's copyleft
     terms create real friction with app store distribution — client
     binaries generally shouldn't carry strong copyleft obligations, and
     it complicates bundling with other libraries in the client apps.
2. **Split by directory**: Apache-2.0 for everything a user runs locally
   (`apps/web`, `apps/mobile`, `apps/desktop`, `packages/*`), AGPL-3.0-or-later
   for `apps/server` only.

## Decision

Option 2. Concretely:

- `apps/server/**` → AGPL-3.0-or-later (its own `LICENSE` file).
- Everything else → Apache-2.0 (root `LICENSE`/`LICENSE-APACHE`, and a copy
  in each other app/package directory).
- Every source file carries an SPDX header matching its path, enforced by
  `tools/check-license-headers.mjs` (`pnpm license:check`).
- Contributions are covered by a CLA (`docs/CLA.md`) granting bandstandhq
  the rights needed to keep this split (and relicense later if that ever
  becomes necessary to keep the project healthy) without needing to track
  down every past contributor individually.
- The "Bandstand" name and logo are explicitly **not** part of either
  license grant — they're unlicensed trademarks, called out separately in
  the README, so a fork is free under the code license but shouldn't reuse
  the name/branding without permission.

## Consequences

- App store distribution of `apps/web`/`apps/mobile`/`apps/desktop` isn't
  complicated by AGPL obligations, since none of that code is AGPL.
- Anyone running a modified `apps/server` as a network service must share
  their modifications under AGPL-3.0-or-later — the SaaS-fork loophole
  plain copyleft (or Apache) leaves open is closed for the one component
  where it matters (the thing other people's data flows through).
- Contributors touching both a client package and the server in one PR
  need to apply the correct header per file, not per PR — this is a small
  ongoing friction the CI license check exists specifically to catch.
