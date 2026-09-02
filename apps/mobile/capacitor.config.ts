// SPDX-License-Identifier: Apache-2.0
import type { CapacitorConfig } from '@capacitor/cli';

// This app is a thin wrapper — it loads the apps/web build and contains no
// feature logic of its own. `npx cap add ios` (needs Xcode, not assumed to
// be present here) is a manual follow-up; see README.md and BUILDING.md.
const config: CapacitorConfig = {
  appId: 'io.bandstand.app',
  appName: 'Bandstand',
  webDir: '../web/dist',
};

export default config;
