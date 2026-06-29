import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';

type SwitchProps = ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>;

export const Switch = forwardRef<ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(function Switch(
    { checked, disabled, className = '', ...props },
    ref,
) {
    return (
        <SwitchPrimitive.Root
            {...props}
            ref={ref}
            checked={checked}
            disabled={disabled}
            className={[
                'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface',
                disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                checked ? 'border-brand bg-brand' : 'border-warm-border bg-warm-muted',
                className,
            ].filter(Boolean).join(' ')}
        >
            <SwitchPrimitive.Thumb
                className={[
                    'pointer-events-none block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-150',
                    checked ? 'translate-x-5' : 'translate-x-0.5',
                ].join(' ')}
            />
        </SwitchPrimitive.Root>
    );
});
