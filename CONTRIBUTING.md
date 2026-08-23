# Contributing to Bandstand

Thanks for considering a contribution. This project runs on a CLA (see
[docs/CLA.md](docs/CLA.md)) — signing happens automatically via a bot
comment the first time you open a pull request.

## Setup, in five lines

```bash
git clone https://github.com/bandstandhq/bandstand.git
cd bandstand
cp .env.example .env
pnpm install
pnpm dev
```

That's it — `pnpm dev` brings up Postgres and Mailpit in Docker, applies
migrations, and starts the web app (http://localhost:5173) and server
(http://localhost:3001). Run `pnpm seed` afterwards for demo data (two
users, a band, ten-plus songs with real ChordPro content, two setlists) —
useful for anything Stage Mode or setlist related.

## Repo layout

```
apps/
  web/      React PWA — the actual application, all feature UI lives here
  server/   Hono API + Hocuspocus + Drizzle migrations (AGPL-3.0-or-later)
  mobile/   Capacitor wrapper — config only, no feature logic
  desktop/  Tauri v2 wrapper — config only, no feature logic
packages/
  core/       domain types, Zod schemas, the Yjs document schema, pure logic
  chords/     ChordPro parsing/transposition/render-model
  ui/         shared React components (+ Storybook)
  api-client/ typed client for apps/server
docs/         ARCHITECTURE.md, SELF_HOSTING.md, adr/, CLA.md, CONTACT.md
docker/       compose.yml + Dockerfiles for local infra
```

Everything under `apps/web`, `apps/mobile`, `apps/desktop`, and `packages/*`
is Apache-2.0. `apps/server` is AGPL-3.0-or-later. See the README's
"Licensing" section for why.

## Commit convention

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`,
`fix:`, `chore:`, `docs:`, etc. Small, self-contained commits are preferred
over one big one.

## Definition of Done

A change is done when:

- `pnpm turbo run lint typecheck test build` passes.
- `pnpm license:check` passes (every new source file has the right SPDX
  header for its path — Apache-2.0 everywhere except `apps/server`, which
  is AGPL-3.0-or-later).
- Domain logic lives in `packages/core` (or `packages/chords`) and is
  tested without React, not buried in a component.
- A non-trivial architectural decision has an ADR under `docs/adr/`
  (context, options considered, decision, consequences — see existing ones
  for the format).
- UI changes were actually looked at in a browser, not just typechecked.

## Adding a feature end-to-end (example shape)

Most features touch layers in this order:

1. **`packages/core`**: add/extend the Zod schema for the new data shape,
   with unit tests.
2. **`apps/server`**: if it needs a new Postgres table, add a Drizzle schema
   file under `src/db/schema/` and run `pnpm --filter @bandstand/server
   db:generate` to create the migration; if it's collaborative data, it
   probably belongs in the Yjs band document instead (see
   `docs/ARCHITECTURE.md`), not a new table.
3. **`packages/ui`**: add any new shared component here if more than one
   page needs it; keep page-specific UI in `apps/web/src/pages`.
4. **`apps/web`**: wire up the page/route, using the schema from step 1 for
   validation and types.
5. Tests: unit tests alongside the logic they cover; a Playwright test only
   for flows that genuinely need a real browser (auth redirects, Stage Mode
   sync — see `apps/web/e2e/`).

## Working with long standard-license/policy texts

When a file needs to contain a long, standard, third-party legal or policy
document verbatim (an OSS license full text, the Contributor Covenant, a
CLA template, etc.), **fetch it from its canonical source instead of typing
it out by hand** — e.g.:

```bash
curl -sSLo LICENSE-APACHE https://www.apache.org/licenses/LICENSE-2.0.txt
curl -sSLo LICENSE-AGPL   https://www.gnu.org/licenses/agpl-3.0.txt
```

This avoids transcription mistakes in legally sensitive text and is simply
more reliable than reproducing a long standard document from memory.
Short, project-specific snippets (an SPDX header line, a short original CLA
clause) are fine to write directly.

## Code of Conduct

By participating, you're expected to uphold the
[Code of Conduct](CODE_OF_CONDUCT.md).
