
/**
 * App-wide confirm dialog. Mount `<ConfirmDialogProvider>` once near the root,
 * then call `const confirm = useConfirm(); await confirm({...})` anywhere.
 *
 * Why promise-based: callers are almost always mid-handler ("user clicked X,
 * should I really do it?"), and awaiting a promise keeps the control flow
 * linear — no need to split logic across onConfirm/onCancel callbacks.
 */
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';

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
        <AlertDialogPrimitive.Root
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen && pending) onClose(false);
            }}
        >
            <AlertDialogPrimitive.Portal>
                <AlertDialogPrimitive.Overlay asChild>
                    <motion.div
                        className="clash-confirm-dialog-backdrop fixed inset-0 z-[10000]"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.12 }}
                    />
                </AlertDialogPrimitive.Overlay>
                <motion.div
                    className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
                >
                    <AlertDialogPrimitive.Content
                        asChild
                        onOpenAutoFocus={(event) => {
                            event.preventDefault();
                            confirmBtnRef.current?.focus();
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                if (pending) onClose(true);
                            }
                        }}
                    >
                        <motion.div
                            className="clash-confirm-dialog-surface relative w-full max-w-sm overflow-hidden rounded-2xl"
                            initial={{ y: 8, opacity: 0, scale: 0.98 }}
                            animate={{ y: 0, opacity: 1, scale: 1 }}
                            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                        >
                            {pending ? (
                                <>
                                    <div className="px-5 pt-5 pb-4">
                                        {pending.opts.title ? (
                                            <AlertDialogPrimitive.Title className="text-sm font-bold text-slate-950 tracking-tight mb-1.5 dark:text-slate-50">
                                                {pending.opts.title}
                                            </AlertDialogPrimitive.Title>
                                        ) : null}
                                        <AlertDialogPrimitive.Description className="text-sm text-stone-700 leading-relaxed dark:text-stone-300">
                                            {pending.opts.message}
                                        </AlertDialogPrimitive.Description>
                                    </div>
                                    <div className="clash-confirm-dialog-footer flex justify-end gap-2 border-t border-warm-border/70 px-4 py-3">
                                        <AlertDialogPrimitive.Cancel asChild>
                                            <button
                                                type="button"
                                                className="clash-confirm-secondary px-3 py-2 min-h-[36px] rounded-lg text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface"
                                            >
                                                {pending.opts.cancelText ?? 'Cancel'}
                                            </button>
                                        </AlertDialogPrimitive.Cancel>
                                        <AlertDialogPrimitive.Action asChild>
                                            <button
                                                type="button"
                                                ref={confirmBtnRef}
                                                onClick={() => onClose(true)}
                                                className={`px-3 py-2 min-h-[36px] rounded-lg text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface ${
                                                    pending.opts.destructive
                                                        ? 'clash-confirm-danger'
                                                        : 'clash-confirm-primary'
                                                }`}
                                            >
                                                {pending.opts.confirmText ?? 'Confirm'}
                                            </button>
                                        </AlertDialogPrimitive.Action>
                                    </div>
                                </>
                            ) : null}
                        </motion.div>
                    </AlertDialogPrimitive.Content>
                </motion.div>
            </AlertDialogPrimitive.Portal>
        </AlertDialogPrimitive.Root>
    );
}

// Convenience no-op used during SSR/unmounted contexts. Kept exported so
// callers in tests can pass it in place of the real hook.
export const noopConfirm: ConfirmFn = async () => true;
