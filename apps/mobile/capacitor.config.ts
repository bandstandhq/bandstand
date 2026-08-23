// SPDX-License-Identifier: Apache-2.0
import type { CapacitorConfig } from '@capacitor/cli';

// This app is a thin wrapper — it loads the apps/web build and contains no
// feature logic of its own. `npx cap add ios` / `npx cap add android` (which
// need Xcode / the Android SDK, not assumed to be present here) are a
// manual follow-up; see README.md.
const config: CapacitorConfig = {
  appId: 'net.bandstandhq.app',
  appName: 'Bandstand',
  webDir: '../web/dist',
};

export default config;
