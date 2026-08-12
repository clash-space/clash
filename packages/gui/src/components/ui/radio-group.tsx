import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';

import { cn } from '../../lib/cn';

export const RadioGroup = forwardRef<
    ElementRef<typeof RadioGroupPrimitive.Root>,
    ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(function RadioGroup({ className, ...props }, ref) {
    return (
        <RadioGroupPrimitive.Root
            ref={ref}
            className={cn('grid grid-cols-1 gap-1.5', className)}
            {...props}
        />
    );
});

export interface RadioGroupItemProps extends ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item> {
    children: ReactNode;
}

export const RadioGroupItem = forwardRef<
    ElementRef<typeof RadioGroupPrimitive.Item>,
    RadioGroupItemProps
>(function RadioGroupItem({ children, className, ...props }, ref) {
    return (
        <RadioGroupPrimitive.Item
            ref={ref}
            className={cn(
                'group/radio flex w-full cursor-pointer items-start gap-2.5 rounded-lg border border-warm-border px-3 py-2 text-left transition-colors hover:bg-warm-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface data-[state=checked]:border-brand data-[state=checked]:bg-brand/10 disabled:cursor-not-allowed disabled:opacity-50 dark:data-[state=checked]:bg-brand/15',
                className,
            )}
            {...props}
        >
            <span
                className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border border-stone-400 bg-warm-surface transition-colors group-data-[state=checked]/radio:border-brand"
                aria-hidden="true"
            >
                <RadioGroupPrimitive.Indicator className="h-2 w-2 rounded-full bg-brand" />
            </span>
            <span className="min-w-0 flex-1">{children}</span>
        </RadioGroupPrimitive.Item>
    );
});
