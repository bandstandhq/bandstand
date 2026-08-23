# Security Policy

## Reporting a Vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

Instead, report it privately via the address in [docs/CONTACT.md](docs/CONTACT.md).
Include as much detail as you can (affected version/commit, reproduction steps,
impact) so we can triage quickly.

We'll acknowledge reports within a few days and keep you updated as we work
on a fix. Once a fix is released, we'll credit reporters who wish to be
credited in the release notes.

## Scope

Bandstand is self-hosted software. Known-scope areas that get particular
scrutiny:

- Authentication and session/JWT handling (`apps/server`)
- Band-membership authorization on collaborative documents (Hocuspocus)
- The invite-code redemption flow
- File upload / attachment handling

Issues in third-party dependencies should generally be reported upstream,
but feel free to let us know too if it affects Bandstand directly.
