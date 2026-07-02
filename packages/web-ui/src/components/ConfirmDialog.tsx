
/**
 * App-wide confirm dialog. Mount `<ConfirmDialogProvider>` once near the root,
 * then call `const confirm = useConfirm(); await confirm({...})` anywhere.
 *
 * Why promise-based: callers are almost always mid-handler ("user clicked X,
 * should I really do it?"), and awaiting a promise keeps the control flow
 * linear — no need to split logic across onConfirm/onCancel callbacks.
 */
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogDescription,
    AlertDialogSurface,
    AlertDialogTitle,
} from './ui/alert-dialog';
import { Button } from './ui/button';

export interface ConfirmOptions {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    /** Treat the primary action as destructive with stronger brand emphasis. */
    destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
    const fn = useContext(ConfirmContext);
    if (!fn) throw new Error('useConfirm must be used inside <ConfirmDialogProvider>');
    return fn;
}

interface PendingRequest {
    opts: ConfirmOptions;
    resolve: (ok: boolean) => void;
}

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
    const [pending, setPending] = useState<PendingRequest | null>(null);

    const confirm = useCallback<ConfirmFn>((opts) => {
        return new Promise<boolean>((resolve) => {
            setPending({ opts, resolve });
        });
    }, []);

    const close = useCallback((ok: boolean) => {
        setPending((prev) => {
            prev?.resolve(ok);
            return null;
        });
    }, []);

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            <ConfirmDialog pending={pending} onClose={close} />
        </ConfirmContext.Provider>
    );
}

function ConfirmDialog({
    pending,
    onClose,
}: {
    pending: PendingRequest | null;
    onClose: (ok: boolean) => void;
}) {
    const confirmBtnRef = useRef<HTMLButtonElement>(null);
    const open = !!pending;

    return (
        <AlertDialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen && pending) onClose(false);
            }}
        >
            <AlertDialogSurface
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    confirmBtnRef.current?.focus();
                }}
            >
                {pending ? (
                    <>
                        <div className="px-5 pt-5 pb-4">
                            {pending.opts.title ? (
                                <AlertDialogTitle className="text-sm font-bold text-slate-950 tracking-tight mb-1.5 dark:text-slate-50">
                                    {pending.opts.title}
                                </AlertDialogTitle>
                            ) : null}
                            <AlertDialogDescription className="text-sm text-stone-700 leading-relaxed dark:text-stone-300">
                                {pending.opts.message}
                            </AlertDialogDescription>
                        </div>
                        <div className="clash-confirm-dialog-footer flex justify-end gap-2 border-t border-warm-border/70 px-4 py-3">
                            <AlertDialogCancel asChild>
                                <Button
                                    size="sm"
                                    className="clash-confirm-secondary px-3 py-2 text-xs font-medium"
                                >
                                    {pending.opts.cancelText ?? 'Cancel'}
                                </Button>
                            </AlertDialogCancel>
                            <AlertDialogAction asChild>
                                <Button
                                    size="sm"
                                    variant={pending.opts.destructive ? 'destructive' : 'primary'}
                                    ref={confirmBtnRef}
                                    onClick={() => onClose(true)}
                                    className={`px-3 py-2 text-xs font-semibold ${
                                        pending.opts.destructive
                                            ? 'clash-confirm-danger'
                                            : 'clash-confirm-primary'
                                    }`}
                                >
                                    {pending.opts.confirmText ?? 'Confirm'}
                                </Button>
                            </AlertDialogAction>
                        </div>
                    </>
                ) : null}
            </AlertDialogSurface>
        </AlertDialog>
    );
}

// Convenience no-op used during SSR/unmounted contexts. Kept exported so
// callers in tests can pass it in place of the real hook.
export const noopConfirm: ConfirmFn = async () => true;
