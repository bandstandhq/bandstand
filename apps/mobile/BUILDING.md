# Building the Android app

`apps/mobile` is a thin [Capacitor](https://capacitorjs.com/) wrapper around the `apps/web`
build — see `README.md`. `apps/mobile/android/` is a real, checked-in native Android project
(Capacitor's own recommendation, unlike Cordova: you're expected to edit native files directly,
so it lives in version control rather than being regenerated from scratch every time). Everything
that doesn't require the Android SDK is already done:

- `capacitor.config.ts`: `appId: 'io.bandstand.app'`, `appName: 'Bandstand'`, `webDir: '../web/dist'`.
- `android/app/src/main/AndroidManifest.xml`: `INTERNET`, `WAKE_LOCK` (Stage Mode's
  "keep the screen awake" toggle), and `POST_NOTIFICATIONS` (required on Android 13+ to show any
  notification at all) permissions declared. No camera permission — nothing in the app uses the
  camera; invite-code QR codes are only ever generated for display, never scanned.
- `android/app/build.gradle`: `versionCode 1`, `versionName "0.1.0"`.
- `apps/web/dist` is built and synced into `android/app/src/main/assets/public` via `npx cap sync
  android`.

## What you still need to do

Prefer the terminal over Android Studio's GUI? See [CLI_BUILD.md](CLI_BUILD.md) instead — same
Gradle build underneath, no IDE required.

1. **Install Android Studio** (includes the Android SDK, Android SDK Platform-Tools, and an
   emulator image if you want one): <https://developer.android.com/studio>. On first launch, its
   setup wizard installs the SDK; note the SDK path it reports (usually
   `~/Android/Sdk` on Linux, `~/Library/Android/sdk` on macOS).
2. **Open the project**:
   ```bash
   cd apps/mobile
   npx cap open android
   ```
   This launches Android Studio directly on `apps/mobile/android/`. The first open will run a
   Gradle sync automatically (needs network access to fetch dependencies from Google's and
   Maven Central's repositories — already configured in `android/build.gradle`).
3. **Build and export the APK** from inside Android Studio: `Build` → `Build App Bundle(s) /
   APK(s)` → `Build APK(s)`. For a real release build to distribute (not just to test on your own
   device), you'll also need to set up app signing (`Build` → `Generate Signed Bundle / APK`) —
   Android Studio walks you through creating a keystore if you don't have one yet. Keep that
   keystore file and its passwords somewhere safe outside this repo: every future update has to be
   signed with the same one, or Android treats it as a different app.

## If you change web-side code afterward

Any change to `apps/web` needs to be rebuilt and re-synced before it shows up in the Android app:

```bash
pnpm --filter @bandstand/web build
cd apps/mobile && npx cap sync android
```

`npx cap sync` only touches the copied web assets and Capacitor's own generated config — it never
overwrites the manifest permissions, `versionCode`/`versionName`, or anything else you edit by
hand in `android/`.

## Known limitation: push notifications

This app deliberately has no native push plugin and no Firebase dependency (see
[ADR-0012](../../docs/adr/0012-web-push.md)) — push works the same VAPID-based way as the
installed-PWA/desktop-browser experience. Android's WebView does not run a persistent background
push service the way a full browser process does, so push notifications are not guaranteed to
arrive while this app is fully closed. They work reliably while the app (or its service worker) is
still alive in the background. Revisit this if background delivery turns out to matter in practice
— the fix would be a native push plugin backed by Firebase Cloud Messaging, which is a real
dependency change, not a config tweak.

## Known limitation: minimum Android version

`minSdkVersion` is 24 (Android 7.0, released 2016) — Capacitor's own current default. Lowering it
further isn't a config change; it would mean testing against a materially older WebView.
