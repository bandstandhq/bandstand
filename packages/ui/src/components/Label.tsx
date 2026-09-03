// SPDX-License-Identifier: Apache-2.0
import * as RadixLabel from '@radix-ui/react-label';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

export function Label({ className, ...props }: ComponentProps<typeof RadixLabel.Root>) {
  return (
    <RadixLabel.Root
      className={cn(
        'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
