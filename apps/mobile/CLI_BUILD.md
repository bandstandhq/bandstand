# Building the Android APK from the command line

`BUILDING.md` describes finishing the build from inside Android Studio (`npx cap open android`,
then Build → Build APK(s)). This is the alternative path if you'd rather not open the IDE at all —
Android Studio is really just a GUI wrapper around the same Gradle build described here. Both paths
produce the identical APK.

## Prerequisites

- **A JDK Gradle actually supports.** This project's Gradle wrapper (8.14.3) does not run under a
  very new JDK — trying anyway fails immediately with:
  ```
  BUG! exception in phase 'semantic analysis' in source unit '_BuildScript_' Unsupported class file major version 70
  ```
  ("major version 70" is JDK 26). **JDK 21 (LTS) is a safe, tested choice.** If your system's
  default `java` is too new, download a standalone JDK 21 instead of changing your system JDK —
  e.g. [Eclipse Temurin 21](https://adoptium.net/temurin/releases/?version=21), extracted anywhere,
  and pointed at via `JAVA_HOME` (below) only for this build — nothing here needs it installed
  system-wide.
- **The Android SDK** — command-line tools, `platform-tools`, a `build-tools` version, and the
  `platforms` entry matching `compileSdk` (`apps/mobile/android/variables.gradle`). Installing all
  of Android Studio also gets you this (it manages the SDK under the hood, typically at
  `~/Android/Sdk` on Linux) — you don't need to touch Android Studio itself afterward if you'd
  rather do everything below from the terminal. Or install just the
  [command-line tools](https://developer.android.com/studio#command-line-tools-only) and use
  `sdkmanager` to fetch what you need.

## One-time setup

1. `apps/mobile/android/local.properties` (gitignored, not committed) tells Gradle where the SDK
   lives:
   ```
   sdk.dir=/path/to/your/Android/Sdk
   ```
2. Build `apps/web` and sync it into the Android project (only needed again after a web-side
   change — see `BUILDING.md`'s "If you change web-side code afterward"):
   ```bash
   pnpm --filter @bandstand/web build
   cd apps/mobile && npx cap sync android
   ```

## Unsigned debug build

```bash
cd apps/mobile/android
JAVA_HOME=/path/to/jdk-21 \
ANDROID_HOME=/path/to/Android/Sdk \
ANDROID_SDK_ROOT=/path/to/Android/Sdk \
  ./gradlew assembleDebug
```

Output: `app/build/outputs/apk/debug/app-debug.apk` — installable directly
(`adb install app/build/outputs/apk/debug/app-debug.apk`), not signed for distribution, fine for
testing on your own device.

## Signed release build

A release build needs a real signing keystore — `apps/mobile/android/app/build.gradle` reads it
from the environment (`KEYSTORE_PATH`/`KEYSTORE_PASSWORD`/`KEY_ALIAS`/`KEY_PASSWORD`) rather than
having it hardcoded, so the keystore itself and its passwords never need to go anywhere near this
repo.

1. **Generate a keystore** (once — reuse the same one for every future update; a new keystore
   means Android treats it as a different app):
   ```bash
   keytool -genkeypair -v -keystore ~/bandstand-release.keystore -alias bandstand \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
   The distinguished-name prompts (name, organization, locality, ...) are purely informational —
   Android neither checks nor displays them. Just press enter through them (defaults to
   "Unknown"). The keystore password and the key password are what matter — pick real ones and
   keep them somewhere durable (a password manager), since losing them means you can never sign an
   update to this app again with the same identity.
2. **Build it**:
   ```bash
   cd apps/mobile/android
   JAVA_HOME=/path/to/jdk-21 \
   ANDROID_HOME=/path/to/Android/Sdk \
   KEYSTORE_PATH=~/bandstand-release.keystore \
   KEYSTORE_PASSWORD=<your keystore password> \
   KEY_PASSWORD=<your key password> \
     ./gradlew assembleRelease
   ```
   (`KEY_ALIAS` defaults to `bandstand`, matching the `-alias` used above — only pass it if you
   used a different alias.)
3. **Output**: `app/build/outputs/apk/release/app-release.apk`. Confirm it's actually signed:
   ```bash
   apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
   ```
   (`apksigner` ships in the SDK's `build-tools/<version>/` directory.) This prints the signing
   certificate's details if the APK is properly signed, and fails loudly if it isn't.

## Notes

- `local.properties`, the keystore file, and its passwords are all local/secret — none of them are
  or should be committed to this repository.
- If `KEYSTORE_PATH` isn't set, `assembleRelease` still succeeds and produces an **unsigned**
  release build — useful for confirming the release build type itself compiles, not for
  distributing.
- `versionCode`/`versionName` (`apps/mobile/android/app/build.gradle`) need a manual bump for each
  new release you intend to actually publish/update from — this isn't automated.
