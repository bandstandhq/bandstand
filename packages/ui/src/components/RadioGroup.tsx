// SPDX-License-Identifier: Apache-2.0
import * as RadixRadioGroup from '@radix-ui/react-radio-group';
import { Circle } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

export function RadioGroup({ className, ...props }: ComponentProps<typeof RadixRadioGroup.Root>) {
  return <RadixRadioGroup.Root className={cn('grid gap-2', className)} {...props} />;
}

export function RadioGroupItem({ className, ...props }: ComponentProps<typeof RadixRadioGroup.Item>) {
  return (
    <RadixRadioGroup.Item
      className={cn(
        'aspect-square h-4 w-4 rounded-full border border-input text-primary shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadixRadioGroup.Indicator className="flex items-center justify-center">
        <Circle className="h-2 w-2 fill-current text-current" aria-hidden="true" />
      </RadixRadioGroup.Indicator>
    </RadixRadioGroup.Item>
  );
}
