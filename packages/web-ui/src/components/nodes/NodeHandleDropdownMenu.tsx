import { useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';

import { cn } from '../ai-elements/utils';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '../ui/dropdown-menu';

interface NodeHandleDropdownMenuProps {
    ariaLabel: string;
    children: ReactNode;
    contentClassName?: string;
    handleClassName?: string;
    handleSurfaceClassName?: string;
    onOpenChange?: (open: boolean) => void;
    triggerLabel?: string;
}

export function NodeHandleDropdownMenu({
    ariaLabel,
    children,
    contentClassName,
    handleClassName,
    handleSurfaceClassName,
    onOpenChange,
    triggerLabel = ariaLabel,
}: NodeHandleDropdownMenuProps) {
    const [open, setOpen] = useState(false);
    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);
        onOpenChange?.(nextOpen);
    };

    return (
        <DropdownMenu open={open} onOpenChange={handleOpenChange}>
            <div
                className="absolute"
                style={{ top: '50%', right: '-8px', transform: 'translateY(-50%)' }}
            >
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        aria-label={triggerLabel}
                        className={cn(
                            'relative flex h-4 w-4 items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface',
                            handleSurfaceClassName,
                        )}
                    >
                        <Handle
                            type="source"
                            position={Position.Right}
                            style={{ position: 'relative', top: 0, right: 0, transform: 'none' }}
                            className={cn(
                                '!h-4 !w-4 !border-4 transition-all duration-200 shadow-sm',
                                open ? '!bg-brand scale-[1.3]' : '!bg-stone-400 hover:!bg-brand hover:scale-125',
                                handleClassName,
                            )}
                        />
                    </button>
                </DropdownMenuTrigger>
            </div>
            <DropdownMenuContent
                aria-label={ariaLabel}
                side="right"
                align="center"
                sideOffset={16}
                onCloseAutoFocus={(event) => event.preventDefault()}
                className={cn('min-w-[200px]', contentClassName)}
            >
                {children}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function NodeHandleDropdownMenuHeader({ children }: { children: ReactNode }) {
    return (
        <div className="px-2 py-1 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300" aria-hidden="true">
            {children}
        </div>
    );
}

export function NodeHandleDropdownMenuSeparator({ children }: { children: ReactNode }) {
    return (
        <div className="flex items-center gap-2 px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300" role="separator">
            <div className="h-px flex-1 bg-warm-border" aria-hidden="true" />
            {children}
            <div className="h-px flex-1 bg-warm-border" aria-hidden="true" />
        </div>
    );
}

export function NodeHandleDropdownMenuItem({
    children,
    className,
    ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuItem>) {
    return (
        <DropdownMenuItem
            className={cn('min-h-11 px-3 py-2.5', className)}
            {...props}
        >
            {children}
        </DropdownMenuItem>
    );
}
