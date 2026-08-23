# @bandstand/desktop

A thin [Tauri v2](https://v2.tauri.app/) wrapper around the `apps/web`
build. This app contains **no feature logic** — every feature lives in
`apps/web` and is written once.

## What's here (Milestone 0)

A real, working `src-tauri/` project (generated via `tauri init --ci` and
verified to compile with `cargo check`), pointed at `../web/dist` as its
`frontendDist`. `pnpm build` (the one CI runs) only asserts that `apps/web`
has already been built — it does **not** invoke a real Tauri build, since
that needs a Rust toolchain plus platform build tools (WebView2 on Windows,
webkit2gtk on Linux, Xcode command line tools on macOS) that aren't
reasonable to assume in every environment this repo gets cloned into.

## Building for real

```bash
pnpm --filter @bandstand/web build   # tauri.conf.json's frontendDist must exist
pnpm --filter @bandstand/desktop dev:native    # or:
pnpm --filter @bandstand/desktop build:native
```

Platform-specific plugins (wake-lock, filesystem, mDNS for LAN discovery)
get added as those features are built — see `docs/ARCHITECTURE.md`.
