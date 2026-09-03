// SPDX-License-Identifier: Apache-2.0
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps, HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

/**
 * A real modal, for confirmations `window.confirm` can't express (e.g.
 * typing a song title to confirm a permanent delete) — plain yes/no
 * confirmations elsewhere in the app still use window.confirm, this isn't
 * meant to replace those. shadcn/ui's usual composable shape (`Dialog`,
 * `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`,
 * `DialogDescription`, `DialogFooter`, `DialogClose`) rather than the
 * fixed-prop API this had before.
 */
export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

/**
 * `closeLabel` is required (not optional) rather than defaulting to an
 * English string here: the visible X is the only way out of this dialog on
 * a phone that has no Escape key and — on mobile, where this covers the
 * full screen — no visible dimmed area to tap either, so it can't be
 * skipped, and packages/ui has no i18n context of its own to fall back to.
 */
export function DialogContent({
  className,
  children,
  closeLabel,
  ...props
}: ComponentProps<typeof RadixDialog.Content> & { closeLabel: string }) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
      <RadixDialog.Content
        className={cn(
          'fixed inset-0 z-50 flex w-full max-w-full flex-col gap-4 overflow-y-auto border-border bg-card p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] text-card-foreground shadow-lg sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[85vh] sm:w-[calc(100%-2rem)] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border sm:p-6',
          className,
        )}
        {...props}
      >
        {children}
        <RadixDialog.Close asChild>
          <button
            type="button"
            aria-label={closeLabel}
            className="absolute right-4 top-4 shrink-0 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </RadixDialog.Close>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 pr-8', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof RadixDialog.Title>) {
  return <RadixDialog.Title className={cn('text-lg font-medium', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof RadixDialog.Description>) {
  return <RadixDialog.Description className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
