import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';

import { cn } from '../ai-elements/utils';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export const PopoverContent = forwardRef<
    ElementRef<typeof PopoverPrimitive.Content>,
    ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent(
    { className, sideOffset = 8, collisionPadding = 12, ...props },
    ref,
) {
    return (
        <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
                ref={ref}
                sideOffset={sideOffset}
                collisionPadding={collisionPadding}
                className={cn(
                    'z-[80] rounded-2xl border border-warm-border/90 bg-warm-surface shadow-[0_18px_48px_rgba(35,31,25,0.14)] outline-none',
                    'dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_18px_48px_rgba(0,0,0,0.36)]',
                    'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                    className,
                )}
                {...props}
            />
        </PopoverPrimitive.Portal>
    );
});
