# ADR-0001: Monorepo with thin native wrappers

## Context

Bandstand ships to four surfaces: a web PWA, iOS, Android, and desktop
(Windows/macOS/Linux). The project's stated non-goal is feature bloat and
maintenance overhead — a feature written four times (once per platform) is
both a bloat risk and a bug-multiplier, since fixes have to land four times
too.

## Options considered

1. **Separate native codebases per platform** (Swift/Kotlin/Electron or
   similar). Maximum platform fidelity, but every feature is written and
   tested N times, and N codebases drift over time.
2. **React Native** for mobile + a separate Electron/Tauri desktop app.
   Cuts the codebase count to two (React Native + web), still duplicates
   UI code between the RN and web trees, and pulls in a second large
   framework and its own tooling/versioning concerns.
3. **One web codebase (`apps/web`), wrapped thinly** by Capacitor (mobile)
   and Tauri v2 (desktop), each loading the same built web bundle and
   adding only platform integration (wake-lock, filesystem, mDNS for LAN
   discovery) via native plugins — no UI or business logic of their own.

## Decision

Option 3. `apps/mobile` and `apps/desktop` are deliberately thin: their
only job is to embed the `apps/web` build and expose native capabilities
web APIs can't reach. Every feature is written once, in `apps/web` and the
shared `packages/*`.

Monorepo tooling: pnpm workspaces + Turborepo, so the four apps and four
shared packages build/test/lint through one dependency graph instead of
four separate repos with manually-synced package versions.

## Consequences

- Adding a feature never means "and now update three more platforms" —
  it's one PR against `apps/web`/`packages/*`.
- Native capabilities still need per-platform plugin glue (a wake-lock
  plugin, a filesystem plugin, an mDNS plugin) — that work isn't
  eliminated, just isolated to the two wrapper apps instead of leaking
  into feature code.
- **Auth transport isn't perfectly uniform across the "one codebase."**
  Browsers use better-auth's cookie session; a Capacitor/Tauri WebView
  (`capacitor://`/`tauri://` origins) can't rely on cross-origin cookies
  reliably, so those contexts use the `jwt()`/`bearer()` plugins instead,
  with the token held in native secure storage. This branch lives inside
  `apps/web`'s own auth client (`Capacitor.isNativePlatform()` / Tauri
  detection), not in the wrapper apps — so "no feature logic in the
  wrappers" still holds, but "one codebase, zero platform branching" is
  not quite true. Worth knowing before someone assumes otherwise.
- Milestone 0 scaffolds `apps/mobile`/`apps/desktop` as config only
  (`capacitor.config.ts`, a real `tauri init`-generated `src-tauri/`).
  Running `cap add ios/android` and producing installable native builds
  needs Xcode/Android SDK/a full Rust toolchain and isn't assumed to be
  available everywhere this repo is cloned — that's a manual, documented
  follow-up (see each app's README), and neither is invoked in CI.
