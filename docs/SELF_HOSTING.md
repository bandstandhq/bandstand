# Self-Hosting

> This is a starting point, not a production runbook yet — `docker/compose.yml`
> covers local development only (Postgres, Mailpit, MinIO). A hardened
> production compose file, TLS termination, and backup guidance are
> follow-up work.

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

## Quick start (development-grade — see the caveat above)

```bash
git clone https://github.com/bandstandhq/bandstand.git
cd bandstand
cp .env.example .env    # edit BETTER_AUTH_SECRET, SMTP_*, etc. for real use
pnpm install
pnpm dev
```

`pnpm dev` is meant for local development. For an always-on deployment,
build and run `apps/server`'s Docker image directly instead of using the
dev script:

```bash
docker build -f docker/Dockerfile.server -t bandstand-server .
docker run -p 3001:3001 -p 3002:3002 --env-file .env bandstand-server
```

...and serve `apps/web`'s static build (`pnpm --filter @bandstand/web build`,
then serve `apps/web/dist` with any static file server or CDN) separately.

## Configuration

All configuration is environment variables — see `.env.example` for the
full list with comments. At minimum, change `BETTER_AUTH_SECRET` and the
`MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` pair to real generated values before
exposing this to the internet — all three ship as obviously-fake
development placeholders, and the server refuses to start with the MinIO
ones left unchanged once `NODE_ENV=production` (which the shipped
`docker/Dockerfile.server` already sets).

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

`docker/compose.yml`'s `minio-init` service already does this for local
development, using `WEB_ORIGIN` as the allowed origin. If you self-host
with the bundled MinIO, you only need to get `WEB_ORIGIN` right; the CORS
config follows automatically on every `docker compose up`.

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
   server process — they're `pnpm push:due`, meant to run on a schedule you set up yourself:
   ```cron
   0 * * * * cd /path/to/bandstand && pnpm push:due >> /var/log/bandstand-push-due.log 2>&1
   ```
   Hourly is what the reminder windows are sized around; a longer interval means an
   occurrence can drift past a reminder's window without ever firing it.

## Not yet covered here

- TLS/reverse-proxy setup
- Backup/restore for the Postgres volume and the object store's data
- Multi-instance/scaling guidance

If you self-host and hit a gap in this doc, please open an issue — that's
exactly the kind of contribution `good first issue`-sized documentation
work is for.
