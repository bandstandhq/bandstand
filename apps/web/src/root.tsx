// SPDX-License-Identifier: Apache-2.0
import { Links, Meta, Outlet, Scripts } from 'react-router';

// Framework Mode generates the whole HTML document from this file — there is
// no separate index.html (see docs/SELF_HOSTING.md's note on the SPA build).
// The favicon/theme-color/title tags below are what index.html used to hold.
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        <meta name="theme-color" content="#ffffff" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="icon" type="image/png" href="/favicon.png" sizes="32x32" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <title>Bandstand</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  return <Outlet />;
}
