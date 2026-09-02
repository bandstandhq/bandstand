# Self-Hosting

> `docker/compose.prod.yml` brings up a complete production deployment (server, Postgres, MinIO)
> with one command — see "First start, step by step" below. Backup/restore guidance and
> multi-instance/scaling are still follow-up work; see "Not yet covered here".

## Why self-host

Bandstand's data belongs to the band running it. Self-hosting means no
seat limits, no forced subscription, and the option to run entirely on a
local network (see `docs/ARCHITECTURE.md`'s note on LAN host mode) for a
rehearsal space or venue with unreliable internet.

## What you need

- Docker + Docker Compose
- A domain (optional — LAN-only hosting works without one)
- An SMTP relay for password-reset emails (generic SMTP — see
  `apps/server/src/lib/mailer.ts`; no vendor-specific integration)

## Quick start (development-grade)

This is for trying Bandstand out or contributing to it — not for exposing it to the internet, see
"First start, step by step" below for that.

```bash
git clone https://github.com/bandstandhq/bandstand.git
cd bandstand
cp .env.example .env    # edit BETTER_AUTH_SECRET, SMTP_*, etc. for real use
pnpm install
pnpm dev
```

## First start, step by step (production)

This assumes no prior Docker experience. `docker/compose.prod.yml` brings up three containers —
the server (which also serves the built web app, see `apps/server/src/app.ts`), Postgres, and
MinIO — as one unit.

1. **Install Docker + Docker Compose**: follow
   [Docker's own install instructions](https://docs.docker.com/engine/install/) for your OS —
   the Docker Engine install includes Compose (the `docker compose` subcommand) on every current
   platform, no separate install step.
2. **Get the code**:
   ```bash
   git clone https://github.com/bandstandhq/bandstand.git
   cd bandstand
   cp .env.example .env
   ```
3. **Edit `.env`** — exactly these values are not safe to leave as shipped, before the first
   start:
   - `BETTER_AUTH_SECRET`: generate one with `openssl rand -base64 32`. **The server refuses to
     start** with this left as the shipped placeholder, missing, or under 32 characters (see
     `apps/server/src/lib/envGuard.ts`) — you'll find out immediately, not later.
   - `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`: any two real values (a password manager's generator
     is fine). **The server also refuses to start** with these left as the shipped placeholder.
   - `POSTGRES_PASSWORD`: any real value — **and** update `DATABASE_URL`'s embedded password to
     match. This is the one place nothing enforces consistency for you: get it wrong and the
     server container starts, then fails every database call, since the two values just silently
     disagree about what the password is. `DATABASE_URL`'s host also needs to say `postgres` here
     (that container's name on the compose network), not `localhost`.
   - `WEB_ORIGIN`: the real public origin you're serving this from (see "File storage" below for
     why this matters, and "TLS" below for what that origin actually looks like). **The server
     refuses to start** if this looks like a private/local address instead of a real public one.
   - `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`: a real relay. Nothing enforces
     this one — leave it unset and the server starts fine, password-reset emails just silently go
     nowhere.
4. **Start it**:
   ```bash
   docker compose --env-file .env -f docker/compose.prod.yml up -d --build
   ```
5. **Check it actually worked**:
   ```bash
   docker compose --env-file .env -f docker/compose.prod.yml ps
   ```
   All three services should show `running`/`healthy`. Then:
   ```bash
   docker compose --env-file .env -f docker/compose.prod.yml logs server
   ```
   should show `Migrations applied.` followed by `Bandstand API listening on ...` and Hocuspocus's
   own "Ready." banner — not a crash loop. Finally:
   ```bash
   curl http://localhost:3001/health
   ```
   should answer `{"status":"ok","db":"ok"}`.
6. **Next**: put this behind HTTPS (see "TLS / reverse proxy" below — required, not optional, for
   uploads/offline/push to work at all) and set up the cron jobs under "Reclaiming storage" and
   "Deleting a band" further down.

## Configuration

All configuration is environment variables — see `.env.example` for the
full list with comments. At minimum, change `BETTER_AUTH_SECRET` and the
`MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` pair to real generated values before
exposing this to the internet — all three ship as obviously-fake
development placeholders. The server refuses to start with any of them
left unchanged, or with `BETTER_AUTH_SECRET` missing or shorter than 32
characters, unless `NODE_ENV` is `development` or `test` — which is the
default assumption, not something you opt into: `pnpm dev` sets it for
you, but `pnpm start` and `docker/Dockerfile.server` (both meant for a
real, long-running deployment) deliberately do not, so this applies the
moment you run either of those with the shipped `.env.example` values
still in place.

**Never run `pnpm seed` against a real deployment** — it's a development/demo convenience, not a
self-hosting step, and it creates three working accounts with a password published in this
repository, plus deletes any band whose slug happens to match one of its demo slugs. It refuses to
run outside `NODE_ENV=development`/`test` for exactly this reason (`apps/server/src/seed/index.ts`).

### TLS / reverse proxy

Required, not optional: file uploads and offline mode need a secure context (`https:`), and
`WEB_ORIGIN` is rejected at startup if it isn't a real public origin (see "Configuration" above).
This needs **two** domains/subdomains, not one — the REST API + served web app (port 3001) and
Hocuspocus, the band-doc sync connection (port 3002), are genuinely separate processes (see
`apps/server/src/index.ts`), not one server split by URL path.

**Caddy** (recommended if you're new to this — automatic HTTPS via Let's Encrypt, no separate
certbot step): put this in `/etc/caddy/Caddyfile` and reload Caddy (`systemctl reload caddy` or
however your install manages it). Caddy proxies WebSocket upgrades transparently through a plain
`reverse_proxy` — no extra config needed for the `sync.` block:
```
your-domain.example {
    reverse_proxy localhost:3001
}

sync.your-domain.example {
    reverse_proxy localhost:3002
}
```

**nginx** (if you already run it): the main block is a standard certbot-managed reverse proxy —
the part worth calling out is the `sync.` block, which needs the WebSocket upgrade headers nginx
doesn't add on its own:
```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    server_name sync.your-domain.example;
    # listen 443 ssl; certbot-managed cert directives; ...

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
    }
}
```

Either way, update `.env` to match the domains you actually used, then restart (`docker compose
--env-file .env -f docker/compose.prod.yml up -d`, no rebuild needed — see below):
```
WEB_ORIGIN=https://your-domain.example
SERVER_URL=https://your-domain.example
HOCUSPOCUS_URL=wss://sync.your-domain.example
TRUST_PROXY_HOPS=1
```
`SERVER_URL`/`HOCUSPOCUS_URL` are runtime values the web app fetches from the server at startup
(`GET /config.json`, see `apps/server/src/routes/config.ts`) — changing your domain later is a
config edit and a restart, never a rebuild of the web app. `TRUST_PROXY_HOPS=1` matters for a
different reason than the URLs above: see the next section.

### Reverse proxy: `TRUST_PROXY_HOPS`

Whichever reverse proxy you put in front of this server — nginx, Caddy, Traefik, or anything else
— you need `TRUST_PROXY_HOPS` for the same reason: every IP-based rate limit in this app (signup,
invite creation/redemption, the ICS feed, password reset) keys off the client's IP address, and
behind a reverse proxy that address only ever arrives via the `X-Forwarded-For` header, not the
raw socket connection. `X-Forwarded-For` is also a header the client can send anything it wants
in — so it's trusted only as far as you explicitly say to. The default, `0`, never trusts it at
all (correct with no reverse proxy); set it to `1` for a single reverse proxy in front of this
server, and no higher than however many you actually run — see `.env.example`'s own comment for
why going higher than that reopens the exact spoofing problem this exists to close.

### File storage (MinIO/S3) and `WEB_ORIGIN`

Song attachments (PDFs, images) are content-addressed and stored in an
S3-compatible object store — see
[ADR-0007](adr/0007-content-addressed-files.md) for why. The browser
uploads and downloads files **directly against the object store** via
presigned URLs, never through the app server, which has one consequence
self-hosters need to get right: **`WEB_ORIGIN` must be the actual origin
your web app is served from**, because it's also what the bucket's CORS
policy is opened up for. Get it wrong and uploads fail in the browser with
a CORS error that has nothing obviously to do with `WEB_ORIGIN` in the
error message itself.

**MinIO-specific stumbling block**: standard S3-compatible object stores
configure CORS per-bucket (the `PutBucketCors` API — what `aws s3api
put-bucket-cors` or most S3 client libraries' "set CORS" call does). MinIO
does not implement that API — attempting it (e.g. via `mc cors set`) fails
outright with "a header you provided implies functionality that is not
implemented." MinIO's actual mechanism is a **server-wide** setting
instead:

```bash
mc alias set local http://localhost:9000 <access-key> <secret-key>
mc admin config set local api cors_allow_origin=https://your-band.example.com
mc admin service restart local --json
```

Both `docker/compose.yml` (dev) and `docker/compose.prod.yml` (production) already have their own
`minio-init` service doing this for you, using `WEB_ORIGIN` as the allowed origin. If you self-host
with the bundled MinIO, you only need to get `WEB_ORIGIN` right; the CORS config follows
automatically on every `docker compose up`.

**If you later migrate off MinIO** — to real AWS S3, Backblaze B2, Hetzner
Object Storage, or any other S3-compatible provider — expect to reconfigure
CORS again from scratch, and expect it to look nothing like the commands
above: those all implement the standard per-bucket `PutBucketCors` API
(AWS's own CLI/console, Backblaze's bucket CORS rules UI, Hetzner's bucket
settings), which is the opposite of what MinIO needed. Don't assume the
MinIO recipe transfers — check that provider's own CORS documentation.

### Push notifications

Optional — the server starts and works normally without it, it just never sends a
notification. See [ADR-0012](adr/0012-web-push.md) for why this is a plain Web Push
setup (VAPID + each browser's own push service) with no Firebase or other vendor account.

1. Generate a key pair: `pnpm push:keys`. Add the two printed values to your `.env`:
   ```
   VAPID_PUBLIC_KEY=...
   VAPID_PRIVATE_KEY=...
   VAPID_SUBJECT=mailto:you@your-domain.example
   ```
   Don't regenerate these later — every existing subscription silently stops working the
   moment the key pair changes, since it's what a subscription is cryptographically tied to.
2. The two time-based reminders (missing-response, upcoming-event) aren't sent by the main
   server process — they're `pnpm push:due`, meant to run on a schedule you set up yourself. From
   a full local checkout (`pnpm install` already run):
   ```cron
   0 * * * * cd /path/to/bandstand && pnpm push:due >> /var/log/bandstand-push-due.log 2>&1
   ```
   Running `docker/compose.prod.yml` instead, with no local checkout to run `pnpm` from — exec
   into the already-running `server` container instead:
   ```cron
   0 * * * * cd /path/to/bandstand && docker compose --env-file .env -f docker/compose.prod.yml exec server node_modules/.bin/tsx src/push/due.ts >> /var/log/bandstand-push-due.log 2>&1
   ```
   Hourly is what the reminder windows are sized around; a longer interval means an
   occurrence can drift past a reminder's window without ever firing it.

### Reclaiming storage from deleted/replaced files

Removing a file reference from a voice, or replacing it, never deletes the underlying object
immediately (see [ADR-0007](adr/0007-content-addressed-files.md)) — run `pnpm blobs:gc` whenever
you want to reclaim that space. It's manual and unattended by design, not a cron-scheduled job.
The same run also clears out any abandoned in-progress upload older than 15 minutes (a client that
got a presigned upload URL and then never finished using it — see
[ADR-0015](adr/0015-staged-uploads.md)):

```bash
pnpm blobs:gc
```
Or, running `docker/compose.prod.yml` with no local checkout to run `pnpm` from:
```bash
docker compose --env-file .env -f docker/compose.prod.yml exec server node_modules/.bin/tsx src/blobs/gc.ts
```

## Deleting a band

Deleting a band archives it rather than removing it outright — the owner can restore it
(`POST /bands/:bandId/restore`) any time within 30 days, after which it's gone for good.
Permanent removal isn't automatic; run `pnpm bands:sweep-archived` on a daily schedule (from a full
local checkout):
```cron
0 3 * * * cd /path/to/bandstand && pnpm bands:sweep-archived >> /var/log/bandstand-sweep-archived.log 2>&1
```
Or, running `docker/compose.prod.yml` with no local checkout to run `pnpm` from:
```cron
0 3 * * * cd /path/to/bandstand && docker compose --env-file .env -f docker/compose.prod.yml exec server node_modules/.bin/tsx src/bands/sweepArchived.ts >> /var/log/bandstand-sweep-archived.log 2>&1
```
Without this cron entry, archived bands simply accumulate forever instead of ever being
permanently deleted — restoring still works either way, only the actual cleanup depends on it.

## Not yet covered here

- Backup/restore for the Postgres volume and the object store's data
- Multi-instance/scaling guidance

If you self-host and hit a gap in this doc, please open an issue — that's
exactly the kind of contribution `good first issue`-sized documentation
work is for.
