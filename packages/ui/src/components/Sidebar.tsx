// SPDX-License-Identifier: Apache-2.0
//
// Desktop-only persistent navigation column — a thin set of layout
// primitives, not a Radix-based component: there's no focus trap, portal,
// or open/close transition to manage here (that's what Sheet is for, on
// narrow screens). `collapsed` is a plain controlled prop throughout —
// the whole tree is composed in one place by whoever uses this (an app's
// own sidebar component), so prop-drilling one boolean is simpler than a
// Context nothing else needs.
import { Slot } from '@radix-ui/react-slot';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { ButtonHTMLAttributes, ComponentProps } from 'react';
import { cn } from '../lib/cn';

export function Sidebar({
  collapsed,
  className,
  ...props
}: ComponentProps<'aside'> & { collapsed: boolean }) {
  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        // sticky top-0 + h-dvh keeps this pinned to the viewport while
        // <main> scrolls — without it, a page taller than one viewport
        // (e.g. Account Settings) scrolls the sidebar away with everything
        // else, since a plain h-dvh block is otherwise normal document
        // flow, not fixed to the viewport (issue #241).
        // Width only, not `transition-all` — a theme toggle changing
        // border/background tokens at the same moment shouldn't visibly
        // animate. prefers-reduced-motion is already handled globally
        // (packages/ui/src/styles.css's blanket transition-duration
        // override), not repeated here.
        'sticky top-0 flex h-dvh shrink-0 flex-col border-r border-border bg-background transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-64',
        className,
      )}
      {...props}
    />
  );
}

export function SidebarHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-2 border-b border-border p-3', className)} {...props} />;
}

export function SidebarContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex-1 overflow-y-auto p-2', className)} {...props} />;
}

export function SidebarFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('border-t border-border p-2', className)} {...props} />;
}

export function SidebarNav({ className, ...props }: ComponentProps<'nav'>) {
  return <nav className={cn('flex flex-col gap-1', className)} {...props} />;
}

/**
 * A styling wrapper, not a link itself — `asChild` composes onto whatever
 * single interactive element the caller passes (typically react-router's
 * `Link`, which this package doesn't depend on), same pattern as `Button`'s
 * own `asChild`. The caller supplies the icon + label markup inside that
 * child and is responsible for hiding the label (e.g. `sr-only`) and
 * passing a `title` when `collapsed` — this component only owns the row's
 * hover/active/spacing styling. Deliberately not a Radix Tooltip for the
 * collapsed-state hover label: one hover hint doesn't justify a whole new
 * primitive this package doesn't otherwise need.
 */
export function SidebarMenuButton({
  asChild = false,
  collapsed,
  active,
  className,
  ...props
}: ComponentProps<'a'> & {
  asChild?: boolean;
  collapsed: boolean;
  active?: boolean;
}) {
  const Comp = asChild ? Slot : 'a';
  return (
    <Comp
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-foreground/90 transition-colors hover:bg-accent hover:text-foreground [&_svg]:h-5 [&_svg]:w-5 [&_svg]:shrink-0',
        active && 'bg-accent text-foreground',
        collapsed && 'justify-center px-2',
        className,
      )}
      {...props}
    />
  );
}

export function SidebarTrigger({
  collapsed,
  expandLabel,
  collapseLabel,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  collapsed: boolean;
  expandLabel: string;
  collapseLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={collapsed ? expandLabel : collapseLabel}
      title={collapsed ? expandLabel : collapseLabel}
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
        className,
      )}
      {...props}
    >
      {collapsed ? (
        <PanelLeftOpen className="h-5 w-5" aria-hidden="true" />
      ) : (
        <PanelLeftClose className="h-5 w-5" aria-hidden="true" />
      )}
    </button>
  );
}
