import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';

import { cn } from '../ai-elements/utils';

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function dropdownMenuItemClassName({
    disabled = false,
    className,
}: {
    disabled?: boolean;
    className?: string;
} = {}) {
    return cn(
        'flex min-h-[40px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors',
        'text-slate-900 hover:bg-warm-muted/75 dark:text-slate-100 dark:hover:bg-slate-800/80',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand',
        'data-[highlighted]:bg-warm-muted/75 data-[highlighted]:outline-none dark:data-[highlighted]:bg-slate-800/80',
        disabled && 'cursor-not-allowed opacity-45',
        className,
    );
}

export const DropdownMenuContent = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Content>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(function DropdownMenuContent(
    { className, sideOffset = 8, collisionPadding = 12, ...props },
    ref,
) {
    return (
        <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.Content
                ref={ref}
                sideOffset={sideOffset}
                collisionPadding={collisionPadding}
                className={cn(
                    'z-[80] rounded-2xl border border-warm-border/90 bg-warm-surface p-1.5 shadow-[0_18px_48px_rgba(35,31,25,0.14)]',
                    'dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_18px_48px_rgba(0,0,0,0.36)]',
                    className,
                )}
                {...props}
            />
        </DropdownMenuPrimitive.Portal>
    );
});

export const DropdownMenuItem = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Item>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(function DropdownMenuItem({ className, disabled, ...props }, ref) {
    return (
        <DropdownMenuPrimitive.Item
            ref={ref}
            disabled={disabled}
            className={dropdownMenuItemClassName({ disabled, className })}
            {...props}
        />
    );
});
