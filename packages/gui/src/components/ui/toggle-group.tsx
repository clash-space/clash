import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';

import { cn } from '../../lib/cn';

export const ToggleGroup = ToggleGroupPrimitive.Root;

export const ToggleGroupItem = forwardRef<
    ElementRef<typeof ToggleGroupPrimitive.Item>,
    ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(function ToggleGroupItem({ className, ...props }, ref) {
    return (
        <ToggleGroupPrimitive.Item
            ref={ref}
            className={cn(
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface',
                className,
            )}
            {...props}
        />
    );
});
