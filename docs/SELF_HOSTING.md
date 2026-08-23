# Self-Hosting

> This is a starting point, not a production runbook yet — Milestone 0's
> `docker/compose.yml` covers local development only (Postgres + Mailpit).
> A hardened production compose file, TLS termination, backup guidance, and
> the attachments/S3 story (see `docs/ARCHITECTURE.md`) are follow-up work.

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
full list with comments. At minimum, change `BETTER_AUTH_SECRET` to a real
generated secret (`openssl rand -base64 32`) before exposing this to the
internet; the default is a development-only placeholder.

## Not yet covered here

- TLS/reverse-proxy setup
- Backup/restore for the Postgres volume
- Attachments/S3 storage (not built yet — see `docs/ARCHITECTURE.md`)
- Multi-instance/scaling guidance

If you self-host and hit a gap in this doc, please open an issue — that's
exactly the kind of contribution `good first issue`-sized documentation
work is for.
