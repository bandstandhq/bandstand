// SPDX-License-Identifier: Apache-2.0
import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

/**
 * A real modal, for confirmations `window.confirm` can't express (e.g.
 * typing a song title to confirm a permanent delete) — plain yes/no
 * confirmations elsewhere in the app still use window.confirm, this isn't
 * meant to replace those.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <RadixDialog.Content
          className="fixed inset-0 z-50 flex w-full max-w-full flex-col overflow-y-auto border-border bg-card p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] text-card-foreground shadow-lg sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[85vh] sm:w-[calc(100%-2rem)] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border sm:p-6"
        >
          <RadixDialog.Title className="text-lg font-medium">{title}</RadixDialog.Title>
          {description && (
            <RadixDialog.Description className="mt-1 text-sm text-muted-foreground">
              {description}
            </RadixDialog.Description>
          )}
          <div className="mt-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
