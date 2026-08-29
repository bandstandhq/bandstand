// SPDX-License-Identifier: Apache-2.0
//
// VITE_DEFAULT_SERVER_URL/VITE_DEFAULT_HOCUSPOCUS_URL are baked in at build
// time and default to a loopback host (see .env.example) — fine when the
// app is opened on the same machine the server runs on, wrong the moment
// it's opened from another device (e.g. a phone on the LAN — see
// CONTRIBUTING.md's "Testing on mobile devices" section: the API/WS host
// must follow whatever host the page itself was loaded from, not whatever
// was baked in at build time). Swapping just the hostname at runtime, kept
// to a small well-known set of loopback spellings, means this keeps working
// for every contributor and after every router change with zero
// configuration — a genuinely different, explicitly configured host (a
// real self-hosted deployment) is left untouched.
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

export function withRuntimeHost(urlString: string): string {
  if (typeof window === 'undefined') return urlString;

  let hostname: string;
  try {
    hostname = new URL(urlString).hostname;
  } catch {
    return urlString;
  }

  if (!LOOPBACK_HOSTNAMES.has(hostname.replace(/^\[|\]$/g, ''))) return urlString;
  return urlString.replace(hostname, window.location.hostname);
}
