import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { Toggle as TogglePrimitive } from 'radix-ui';

export const Toggle = forwardRef<
    ElementRef<typeof TogglePrimitive.Root>,
    ComponentPropsWithoutRef<typeof TogglePrimitive.Root>
>(function Toggle({ className = '', ...props }, ref) {
    return (
        <TogglePrimitive.Root
            {...props}
            ref={ref}
            className={[
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface',
                className,
            ].filter(Boolean).join(' ')}
        />
    );
});
