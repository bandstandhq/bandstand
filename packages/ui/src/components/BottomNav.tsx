// SPDX-License-Identifier: Apache-2.0
//
// Narrow-screen persistent tab bar — the Variant-B counterpart to
// Sidebar.tsx's collapsible column. Same split: this file is a thin set of
// styling primitives (no Radix, no portal, no focus trap — the "More" tab's
// overflow content is a Sheet the app composes separately), the actual
// tab list and icons are composed by whoever uses this (an app's own
// bottom-nav component).
import { Slot } from '@radix-ui/react-slot';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

export function BottomNav({ className, ...props }: ComponentProps<'nav'>) {
  return (
    <nav
      className={cn(
        // Fixed to the viewport, not the page — safe-area padding on the
        // bottom only (same convention as Dialog/Sheet's own env()
        // handling); the top edge never needs it, there's nothing to clear
        // there. z-30, one below Sheet's own overlay (z-40) — when the
        // "More" tab opens its sheet, the dimmed overlay must cover this
        // bar too, not leave it poking through above the dimming.
        'fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-border bg-background pb-[env(safe-area-inset-bottom)]',
        className,
      )}
      {...props}
    />
  );
}

/**
 * `asChild` composes onto whatever single interactive element the caller
 * passes (react-router's `Link`, or a plain `<button>` for the "More" tab
 * that opens a Sheet instead of navigating) — same pattern as
 * `SidebarMenuButton`. The caller supplies the icon + label markup inside.
 */
export function BottomNavItem({
  asChild = false,
  active,
  className,
  ...props
}: ComponentProps<'a'> & { asChild?: boolean; active?: boolean }) {
  const Comp = asChild ? Slot : 'a';
  return (
    <Comp
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&_svg]:h-5 [&_svg]:w-5',
        active && 'text-foreground',
        className,
      )}
      {...props}
    />
  );
}
