# Contributing to Bandstand

Thanks for considering a contribution. This project runs on a CLA (see
[docs/CLA.md](docs/CLA.md)) — signing happens automatically via a bot
comment the first time you open a pull request.

## Setup, in four lines

```bash
git clone https://github.com/bandstandhq/bandstand.git
cd bandstand
pnpm install
pnpm dev
```

That's it — `pnpm dev` creates `.env` from `.env.example` on first run,
brings up Postgres and Mailpit in Docker, applies migrations, and starts
the web app (http://localhost:5173) and server (http://localhost:3001).
Run `pnpm seed` afterwards for demo data (two
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
docs/         ARCHITECTURE.md, PERMISSIONS.md, SELF_HOSTING.md, adr/, CLA.md, CONTACT.md
docker/       compose.yml + Dockerfiles for local infra
```

Everything under `apps/web`, `apps/mobile`, `apps/desktop`, and `packages/*`
is Apache-2.0. `apps/server` is AGPL-3.0-or-later. See the README's
"Licensing" section for why.

## Commit convention

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`,
`fix:`, `chore:`, `docs:`, etc. Small, self-contained commits are preferred
over one big one.

## Git workflow

`main` is protected: no direct pushes, PRs required, required status checks
must pass, no force-push. For every change:

```bash
git switch main && git pull
git switch -c <prefix>/<short-name>   # feat/, fix/, chore/, docs/, refactor/, test/
# small Conventional Commits
git push -u origin <prefix>/<short-name>
gh pr create --fill                    # fill in the PR template's test plan
gh pr checks --watch
gh pr merge --squash --delete-branch
git switch main && git pull
```

One PR per logical change, not a batch PR bundling several unrelated
things — this keeps review and revert scoped to one change at a time.
Merges are always squash (repo setting; the other merge methods are
disabled), and the source branch is deleted automatically on merge.

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
- It's on its own branch and PR per the "Git workflow" section above, and
  all required status checks are green before merging.

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

## Drag-and-drop rows

If a dnd-kit drag handle (`{...attributes} {...listeners}` from `useDraggable`/`useSortable`) ends
up on a real interactive element — a `<Link>`/`<a>`, a `<button>` — rather than a dedicated
non-interactive handle (a grip icon `<span>`/`<div>`, as in `SongAnchors.tsx` and
`PdfVoiceViewer.tsx`), you must:

1. Set `draggable={false}` on it. An `<a>` is natively draggable by default, and the browser's own
   native drag-and-drop can win a race against dnd-kit's synthetic recognition under enough
   main-thread load — dnd-kit's own `preventDefault()` on native `dragstart` isn't a guarantee.
2. Suppress the click that follows a completed drag yourself — dnd-kit's own click guard only calls
   `stopPropagation()`, never `preventDefault()`, and is removed on a fixed timer regardless of
   whether the click has arrived. Neither stops a real anchor's native navigation. See
   `SortableSetlistItem` in `apps/web/src/pages/SetlistDetail.tsx` for the pattern: a ref armed by
   `useDndMonitor`'s `onDragStart` for that item's own id, checked and cleared by a `document`-level,
   capture-phase `click` listener registered once at mount (so it runs before dnd-kit's own,
   per-drag one — capture-phase order is DOM position first, then attachment order, so it has to be
   on `document` too, not on the element itself).

Both are real, load-sensitive application bugs, not test artifacts — see
`docs/adr/0014-no-native-drag-on-interactive-rows.md` for the full investigation, including how to
test this under realistic (throttled-CPU) load rather than only a quiet dev machine.

## Testing on mobile devices

By default everything (`pnpm dev`'s web app and API server, plus MinIO) is
only reachable from the machine running it. To open the app on a phone on
the same Wi-Fi/LAN:

1. Find your machine's LAN IP, e.g. `hostname -I` (Linux), `ipconfig
   getifaddr en0` (macOS), or `ipconfig` (Windows).
2. In your `.env` (not `.env.example` — this is per-machine and never
   committed), add that address to `WEB_ORIGIN` as a second,
   comma-separated entry, e.g.:
   ```
   WEB_ORIGIN=http://localhost:5173,http://192.168.1.50:5173
   ```
   This is also what allows the browser's presigned upload/download
   requests straight to MinIO (docs/adr/0007-content-addressed-files.md) —
   without it those are blocked by MinIO's own CORS check, not just the
   API's.
3. Restart infra so MinIO picks up the new CORS origin, then start dev
   normally:
   ```
   pnpm dev:infra:down && pnpm dev
   ```
4. If you also want a phone to fetch its own presigned uploads/downloads
   straight from MinIO (see step 2's note), set `MINIO_ENDPOINT` in your
   `.env` to that same LAN address too, e.g.
   `MINIO_ENDPOINT=http://192.168.1.50:9000` — the server embeds this
   directly into the presigned URLs it hands back, so it has to be an
   address the phone can reach, not `localhost`.
5. On the phone, open `http://192.168.1.50:5173` (your actual LAN address).
   Nothing needs changing on the client side beyond that: it detects
   whatever host the page was loaded from and talks to the API/WebSocket
   on that same host (`apps/web/src/lib/networkHost.ts`), so this keeps
   working after a router change or for any other contributor without
   editing a committed file — only your own `.env` needs your address.

This is enough to log in, browse, and edit already-existing content — the
CRDT sync (Hocuspocus) connects over the LAN address exactly as it would
over `localhost`.

**It is not enough to create anything new (a song, event, poll, setlist,
voice, or file upload).** Those all call `crypto.randomUUID()` and/or
`crypto.subtle` (for a file's hash, see `packages/core/src/files/hash.ts`)
client-side, and browsers restrict both to a *secure context* —
`https://`, or `http://localhost` itself, but not a plain LAN IP over
`http://`. Attempting to save a new song over the LAN address fails
silently with "Couldn't save — check the fields above."; a file upload
fails the same way before it ever reaches the network. This isn't
specific to this app's own code — it's the same reason any web app's
camera/clipboard/crypto APIs need HTTPS on a real device. It also means
the PWA install prompt, offline mode, and push notifications don't work
over a plain LAN address either, for the same secure-context reason
(service workers have the identical restriction).

To test any of that — creating content, uploading a file, the install
prompt, offline mode, push — tunnel the web app through HTTPS with a tool
like [cloudflared](https://github.com/cloudflare/cloudflared):

```
cloudflared tunnel --url http://localhost:5173
```

This prints a temporary `https://*.trycloudflare.com` URL that proxies to
your local Vite server. Two things to set up before it'll load at all:

- Vite rejects requests with a `Host` header it doesn't recognize (a LAN IP
  is allowed automatically, this hostname isn't) — add it to your `.env`:
  ```
  VITE_DEV_ALLOWED_HOSTS=.trycloudflare.com
  ```
- Restart `pnpm dev` after adding it (Vite only reads this at startup).

Open the printed `https://*.trycloudflare.com` URL on the phone instead of
the LAN address. Note that this alone only gets the *web app* onto a
secure context — it does not make the API or Hocuspocus reachable, and
this project's browser auth is cookie-based, not bearer-token, so signing
in against a tunneled API on a different domain than the tunneled web app
doesn't work (the session cookie is blocked as cross-site). In practice
that makes the single web-only tunnel above the useful case: enough to
verify the install prompt and service worker registration on a real
device. Functional testing of writes (new songs, file uploads) still needs
a real secure context with a working session, which today means
`http://localhost:5173` on the machine running the server — on a real
phone, only what step 5 above already covers (viewing and editing existing
content) is currently testable, until there's bearer-token support for the
browser client too.

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
