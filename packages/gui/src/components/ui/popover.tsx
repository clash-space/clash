import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';

import { cn } from '../../lib/cn';

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
                    'z-[80] rounded-2xl border border-overlay-border bg-overlay-surface text-content-primary shadow-overlay outline-none',
                    'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                    className,
                )}
                {...props}
            />
        </PopoverPrimitive.Portal>
    );
});
