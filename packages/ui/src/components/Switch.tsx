// SPDX-License-Identifier: Apache-2.0
import * as RadixSwitch from '@radix-ui/react-switch';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

// Corners follow --radius (rounded-md/-sm), not the pill shape shadcn/ui
// ships by default — matches every other control in this theme (Button,
// Input, ...) instead of introducing a one-off fully-rounded shape.
export function Switch({ className, ...props }: ComponentProps<typeof RadixSwitch.Root>) {
  return (
    <RadixSwitch.Root
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 items-center rounded-md border border-transparent bg-input shadow-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      <RadixSwitch.Thumb className="pointer-events-none block h-4 w-4 translate-x-0.5 rounded-sm bg-background shadow-lg transition-transform data-[state=checked]:translate-x-[18px]" />
    </RadixSwitch.Root>
  );
}
