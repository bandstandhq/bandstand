# @bandstand/mobile

A thin [Capacitor](https://capacitorjs.com/) wrapper around the `apps/web`
build. This app contains **no feature logic** — every feature lives in
`apps/web` and is written once.

## What's here

`capacitor.config.ts` (`appId: io.bandstand.app`, pointing `webDir` at
`../web/dist`) and a real, checked-in `android/` native project — see
[BUILDING.md](BUILDING.md) for what's already set up there and what you
still need a local Android Studio install to finish. `pnpm build` only
asserts that `apps/web` has already been built.

## iOS (not started)

No `ios/` platform directory exists yet — that needs Xcode, which isn't
reasonable to assume is installed everywhere this repo gets cloned. To add
it locally:

```bash
pnpm --filter @bandstand/web build   # capacitor.config.ts's webDir must exist
npx cap add ios
npx cap sync ios
npx cap open ios
```

Platform-specific plugins (wake-lock, filesystem, mDNS for LAN discovery)
get added to the generated `ios/` project as those features are built — see
`docs/ARCHITECTURE.md`.
