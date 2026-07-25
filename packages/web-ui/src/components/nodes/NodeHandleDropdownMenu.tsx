import { type ComponentPropsWithoutRef, type ReactNode, useCallback, useEffect, useRef } from 'react';
import { Handle, Position } from '@xyflow/react';

import { cn } from '../ai-elements/utils';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { IconButton } from '../ui/icon-button';
import { useCanvasTransientUiOwner } from '../CanvasTransientUiContext';

const HOVER_CLOSE_DELAY_MS = 200;

interface NodeHandleDropdownMenuProps {
    ariaLabel: string;
    children: ReactNode;
    contentClassName?: string;
    handleClassName?: string;
    handleSurfaceClassName?: string;
    onOpenChange?: (open: boolean) => void;
    ownerId: string;
    triggerLabel?: string;
}

export function NodeHandleDropdownMenu({
    ariaLabel,
    children,
    contentClassName,
    handleClassName,
    handleSurfaceClassName,
    onOpenChange,
    ownerId,
    triggerLabel = ariaLabel,
}: NodeHandleDropdownMenuProps) {
    const {
        close,
        isOpen,
        open,
    } = useCanvasTransientUiOwner('node-menu', ownerId);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const cancelScheduledClose = useCallback(() => {
        if (closeTimerRef.current === null) return;
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
    }, []);

    const openFromHover = useCallback(() => {
        cancelScheduledClose();
        open();
        onOpenChange?.(true);
    }, [cancelScheduledClose, onOpenChange, open]);

    const scheduleClose = useCallback(() => {
        cancelScheduledClose();
        closeTimerRef.current = setTimeout(() => {
            closeTimerRef.current = null;
            close();
            onOpenChange?.(false);
        }, HOVER_CLOSE_DELAY_MS);
    }, [cancelScheduledClose, close, onOpenChange]);

    useEffect(() => cancelScheduledClose, [cancelScheduledClose]);

    return (
        <DropdownMenu
            open={isOpen}
            onOpenChange={(nextOpen) => {
                if (nextOpen) open();
                else close();
                onOpenChange?.(nextOpen);
            }}
        >
            <div
                className="absolute"
                style={{ top: '50%', right: '-8px', transform: 'translateY(-50%)' }}
                onMouseEnter={openFromHover}
                onMouseLeave={scheduleClose}
            >
                <DropdownMenuTrigger asChild>
                    <IconButton
                        label={triggerLabel}
                        shape="circle"
                        size="sm"
                        className={cn(
                            'group/handle-trigger relative h-4 min-h-4 w-4 min-w-4 border-0 bg-transparent p-0 text-current shadow-none hover:bg-transparent focus-visible:ring-offset-warm-surface',
                            handleSurfaceClassName,
                        )}
                        icon={
                            <Handle
                                type="source"
                                position={Position.Right}
                                style={{ position: 'relative', top: 0, right: 0, transform: 'none' }}
                                className={cn(
                                    '!h-4 !w-4 !border-4 !bg-stone-400 transition-all duration-200 shadow-sm hover:!bg-brand hover:scale-125 group-data-[state=open]/handle-trigger:!bg-brand group-data-[state=open]/handle-trigger:scale-[1.3]',
                                    handleClassName,
                                )}
                            />
                        }
                    />
                </DropdownMenuTrigger>
            </div>
            <DropdownMenuContent
                aria-label={ariaLabel}
                side="right"
                align="center"
                sideOffset={16}
                onMouseEnter={cancelScheduledClose}
                onMouseLeave={scheduleClose}
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
