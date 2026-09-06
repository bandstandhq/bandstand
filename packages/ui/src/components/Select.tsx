// SPDX-License-Identifier: Apache-2.0
import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { createContext, useContext, useRef, useState, type ComponentProps } from 'react';
import { cn } from '../lib/cn';

// Lets SelectTrigger close the select itself — Radix's own trigger only ever opens, never toggles.
const SelectOpenContext = createContext<((open: boolean) => void) | null>(null);

export function Select({ open, onOpenChange, ...props }: ComponentProps<typeof RadixSelect.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = open !== undefined;
  const currentOpen = isControlled ? open : uncontrolledOpen;

  function setOpen(next: boolean) {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }

  return (
    <SelectOpenContext.Provider value={setOpen}>
      <RadixSelect.Root open={currentOpen} onOpenChange={setOpen} {...props} />
    </SelectOpenContext.Provider>
  );
}
export const SelectGroup = RadixSelect.Group;
export const SelectValue = RadixSelect.Value;

export function SelectTrigger({
  className,
  children,
  onClick,
  onPointerDown,
  ...props
}: ComponentProps<typeof RadixSelect.Trigger>) {
  const setOpen = useContext(SelectOpenContext);
  const pointerTypeRef = useRef('touch');
  // Captured at pointerdown, not re-read at click: for touch, Radix's own dismiss logic already closes it in between.
  const wasOpenRef = useRef(false);
  return (
    <RadixSelect.Trigger
      className={cn(
        // pointer-events-auto: Radix sets `pointer-events: none` on <body> while open, which would inherit down and block re-clicking this trigger too.
        'group pointer-events-auto flex h-10 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1',
        className,
      )}
      // Mirrors Radix's own branching: mouse opens via onPointerDown, touch via onClick.
      onPointerDown={(event) => {
        onPointerDown?.(event);
        pointerTypeRef.current = event.pointerType;
        wasOpenRef.current = event.currentTarget.getAttribute('data-state') === 'open';
        if (event.pointerType === 'mouse' && wasOpenRef.current && !event.defaultPrevented) {
          event.preventDefault();
          setOpen?.(false);
        }
      }}
      onClick={(event) => {
        onClick?.(event);
        if (pointerTypeRef.current !== 'mouse' && wasOpenRef.current && !event.defaultPrevented) {
          event.preventDefault();
          setOpen?.(false);
        }
      }}
      {...props}
    >
      {children}
      <RadixSelect.Icon asChild>
        <ChevronDown
          className="h-4 w-4 shrink-0 opacity-50 transition-transform duration-200 group-data-[state=open]:rotate-180"
          aria-hidden="true"
        />
      </RadixSelect.Icon>
    </RadixSelect.Trigger>
  );
}

export function SelectContent({ className, children, position = 'popper', ...props }: ComponentProps<typeof RadixSelect.Content>) {
  return (
    <RadixSelect.Portal>
      <RadixSelect.Content
        className={cn(
          'relative z-50 max-h-96 min-w-32 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md',
          position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
          className,
        )}
        position={position}
        {...props}
      >
        <RadixSelect.Viewport
          className={cn('p-1', position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)]')}
        >
          {children}
        </RadixSelect.Viewport>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  );
}

export function SelectItem({ className, children, ...props }: ComponentProps<typeof RadixSelect.Item>) {
  return (
    <RadixSelect.Item
      className={cn(
        'relative flex w-full cursor-default select-none items-center rounded-sm py-2 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <RadixSelect.ItemIndicator>
          <Check className="h-4 w-4" aria-hidden="true" />
        </RadixSelect.ItemIndicator>
      </span>
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
    </RadixSelect.Item>
  );
}
