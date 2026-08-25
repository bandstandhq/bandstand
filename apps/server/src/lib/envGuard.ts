// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `docker/Dockerfile.server` sets NODE_ENV=production, so a self-hoster who
// copies .env.example into .env and never edits it would otherwise run a
// real production deployment with the placeholder credentials still active
// — a realistic failure mode, not a hypothetical one. Call this for any env
// var whose .env.example value is a dev-only placeholder; it hard-exits
// rather than silently starting up insecurely.
export function assertNotDevPlaceholder(varName: string, value: string | undefined, placeholder: string): void {
  if (process.env.NODE_ENV === 'production' && value === placeholder) {
    console.error(
      `${varName} is still set to its development placeholder value. ` +
        `Set a real value before running in production.`,
    );
    process.exit(1);
  }
}
