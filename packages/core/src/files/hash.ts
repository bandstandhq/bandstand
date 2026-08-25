// SPDX-License-Identifier: Apache-2.0
//
// One implementation for both sides of an upload: the browser hashes a file
// before offering it to the server (to ask "does this already exist?"), and
// the server re-hashes the bytes it actually received to verify the client
// didn't lie. `crypto.subtle` is the Web Crypto API, available as a global
// in both the browser and Node 20+ — no separate Node `createHash` path
// needed, so there's exactly one hashing implementation to trust.
export async function sha256Hex(data: ArrayBuffer | ArrayBufferView): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
