// SPDX-License-Identifier: Apache-2.0
import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { CloseIcon } from './icons';

/**
 * A slide-in side panel — for navigation menus and filter panels, not
 * confirmations (see Dialog for those). Unlike Dialog, this never covers
 * the full viewport: there's always a visible, tappable dimmed area next
 * to it to dismiss it with, in addition to the explicit close button,
 * Escape, and Radix's own focus trap/return-focus-on-close handling.
 *
 * `closeLabel` is required for the same reason as Dialog's: no i18n
 * context in this package, and the close button isn't optional UX here.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  closeLabel,
  side = 'left',
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  closeLabel: string;
  side?: 'left' | 'right';
  children: ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <RadixDialog.Content
          className={cn(
            'fixed inset-y-0 z-50 flex w-[85vw] max-w-xs flex-col overflow-y-auto bg-card p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] text-card-foreground shadow-lg',
            side === 'left' ? 'left-0 border-r border-border' : 'right-0 border-l border-border',
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <RadixDialog.Title className="text-lg font-medium">{title}</RadixDialog.Title>
            <RadixDialog.Close asChild>
              <button
                type="button"
                aria-label={closeLabel}
                className="-m-2 shrink-0 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <CloseIcon />
              </button>
            </RadixDialog.Close>
          </div>
          <div className="mt-4 flex flex-1 flex-col">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
