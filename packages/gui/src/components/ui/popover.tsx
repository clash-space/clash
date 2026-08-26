import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';

import { cn } from '../../lib/cn';

export function Popover(props: ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>) {
    return <PopoverPrimitive.Root {...props} />;
}

export const PopoverTrigger = forwardRef<
    ElementRef<typeof PopoverPrimitive.Trigger>,
    ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>(function PopoverTrigger(props, ref) {
    return <PopoverPrimitive.Trigger ref={ref} data-slot="popover-trigger" {...props} />;
});
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export const PopoverContent = forwardRef<
    ElementRef<typeof PopoverPrimitive.Content>,
    ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent(
    { className, align = 'center', sideOffset = 4, collisionPadding = 12, ...props },
    ref,
) {
    return (
        <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
                ref={ref}
                data-slot="popover-content"
                align={align}
                sideOffset={sideOffset}
                collisionPadding={collisionPadding}
                className={cn(
                    'z-[80] flex w-72 origin-[var(--radix-popover-content-transform-origin)] flex-col gap-2.5 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none',
                    'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
                    className,
                )}
                {...props}
            />
        </PopoverPrimitive.Portal>
    );
});
