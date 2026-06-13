
/**
 * App-wide confirm dialog. Mount `<ConfirmDialogProvider>` once near the root,
 * then call `const confirm = useConfirm(); await confirm({...})` anywhere.
 *
 * Why promise-based: callers are almost always mid-handler ("user clicked X,
 * should I really do it?"), and awaiting a promise keeps the control flow
 * linear — no need to split logic across onConfirm/onCancel callbacks.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

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

    // Focus the primary button on open so Enter works out of the box.
    useEffect(() => {
        if (!open) return;
        const id = requestAnimationFrame(() => confirmBtnRef.current?.focus());
        return () => cancelAnimationFrame(id);
    }, [open]);

    // Global key handling: Esc cancels, Enter confirms.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); onClose(false); }
            if (e.key === 'Enter') { e.preventDefault(); onClose(true); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (typeof document === 'undefined') return null;

    return createPortal(
        <AnimatePresence>
            {open && pending && (
                <motion.div
                    key="confirm-overlay"
                    className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                >
                    <div
                        className="clash-confirm-dialog-backdrop absolute inset-0"
                        onClick={() => onClose(false)}
                        aria-hidden
                    />
                    <motion.div
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby={pending.opts.title ? 'confirm-title' : undefined}
                        aria-describedby="confirm-message"
                        className="clash-confirm-dialog-surface relative w-full max-w-sm overflow-hidden rounded-2xl"
                        initial={{ y: 8, opacity: 0, scale: 0.98 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={{ y: 8, opacity: 0, scale: 0.98 }}
                        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    >
                        <div className="px-5 pt-5 pb-4">
                            {pending.opts.title && (
                                <h2
                                    id="confirm-title"
                                    className="text-sm font-bold text-slate-950 tracking-tight mb-1.5 dark:text-slate-50"
                                >
                                    {pending.opts.title}
                                </h2>
                            )}
                            <p id="confirm-message" className="text-sm text-stone-700 leading-relaxed dark:text-stone-300">
                                {pending.opts.message}
                            </p>
                        </div>
                        <div className="clash-confirm-dialog-footer flex justify-end gap-2 border-t border-warm-border/70 px-4 py-3">
                            <button
                                type="button"
                                onClick={() => onClose(false)}
                                className="clash-confirm-secondary px-3 py-2 min-h-[36px] rounded-lg text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface"
                            >
                                {pending.opts.cancelText ?? 'Cancel'}
                            </button>
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
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body,
    );
}

// Convenience no-op used during SSR/unmounted contexts. Kept exported so
// callers in tests can pass it in place of the real hook.
export const noopConfirm: ConfirmFn = async () => true;
