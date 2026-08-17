import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';

import { cn } from '../../lib/cn';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export interface PopoverContentProps
    extends ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> {
    /** Optional local surface that owns this popover's visual boundary. */
    portalContainer?: HTMLElement | null;
}

export const PopoverContent = forwardRef<
    ElementRef<typeof PopoverPrimitive.Content>,
    PopoverContentProps
>(function PopoverContent(
    {
        className,
        sideOffset = 8,
        collisionPadding = 12,
        portalContainer,
        ...props
    },
    ref,
) {
    return (
        <PopoverPrimitive.Portal container={portalContainer ?? undefined}>
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
