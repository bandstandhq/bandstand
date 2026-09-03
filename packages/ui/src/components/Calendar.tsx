// SPDX-License-Identifier: Apache-2.0
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker, type DayPickerProps } from 'react-day-picker';
import { cn } from '../lib/cn';

export type CalendarProps = DayPickerProps;

/**
 * A thin, generic shadcn/ui-styled wrapper around react-day-picker — layout
 * and chrome only (month caption, nav chevrons, table structure). Per-day
 * cell content is deliberately left to the caller via `components.Day`: a
 * band-scheduling calendar's day cells need to show that day's events, which
 * is page-specific data this package has no business knowing about.
 */
export function Calendar({ className, classNames, components, ...props }: CalendarProps) {
  return (
    <DayPicker
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col',
        month: 'space-y-2',
        month_caption: 'relative flex items-center justify-center pb-2 pt-1',
        caption_label: 'text-sm font-medium',
        nav: 'absolute inset-x-0 top-0 flex items-center justify-between',
        button_previous:
          'inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50',
        button_next:
          'inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50',
        month_grid: 'w-full border-collapse',
        weekdays: '',
        weekday: 'p-1 text-center text-xs font-normal text-muted-foreground',
        week: '',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClassName, size, style }) => {
          const Icon = orientation === 'right' ? ChevronRight : ChevronLeft;
          return (
            <Icon className={cn('h-4 w-4', chevronClassName)} size={size} style={style} aria-hidden="true" />
          );
        },
        ...components,
      }}
      {...props}
    />
  );
}
