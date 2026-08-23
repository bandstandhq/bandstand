# @bandstand/mobile

A thin [Capacitor](https://capacitorjs.com/) wrapper around the `apps/web`
build. This app contains **no feature logic** — every feature lives in
`apps/web` and is written once.

## What's here (Milestone 0)

Just `capacitor.config.ts`, pointing at `../web/dist`. `pnpm build` only
asserts that `apps/web` has already been built.

## Manual follow-up (not done here, needs local toolchains)

Generating and building the actual native projects needs Xcode (iOS) and
the Android SDK (Android), neither of which is reasonable to assume is
installed everywhere this repo gets cloned — so it's not done in Milestone 0
and not run in CI. To do it locally:

```bash
pnpm --filter @bandstand/web build   # capacitor.config.ts's webDir must exist
npx cap add ios
npx cap add android
npx cap sync
npx cap open ios       # or: npx cap open android
```

Platform-specific plugins (wake-lock, filesystem, mDNS for LAN discovery)
get added to the generated `ios/`/`android/` projects as those features are
built — see `docs/ARCHITECTURE.md`.
