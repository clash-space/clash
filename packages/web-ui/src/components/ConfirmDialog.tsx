
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
    /** Treat the primary action as destructive → red accent + tighter phrasing. */
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
                        className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm"
                        onClick={() => onClose(false)}
                        aria-hidden
                    />
                    <motion.div
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby={pending.opts.title ? 'confirm-title' : undefined}
                        aria-describedby="confirm-message"
                        className="relative w-full max-w-sm rounded-2xl bg-warm-surface shadow-2xl border border-warm-border overflow-hidden"
                        initial={{ y: 8, opacity: 0, scale: 0.98 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={{ y: 8, opacity: 0, scale: 0.98 }}
                        transition={{ type: 'spring', damping: 26, stiffness: 420 }}
                    >
                        <div className="px-5 pt-5 pb-4">
                            {pending.opts.title && (
                                <h2
                                    id="confirm-title"
                                    className="text-sm font-bold text-slate-950 tracking-tight mb-1.5"
                                >
                                    {pending.opts.title}
                                </h2>
                            )}
                            <p id="confirm-message" className="text-sm text-stone-600 leading-relaxed">
                                {pending.opts.message}
                            </p>
                        </div>
                        <div className="flex justify-end gap-2 px-4 py-3 bg-warm-muted/70 border-t border-warm-border">
                            <button
                                type="button"
                                onClick={() => onClose(false)}
                                className="px-3 py-1.5 rounded-lg text-xs font-medium text-stone-600 hover:bg-warm-hover transition-colors"
                            >
                                {pending.opts.cancelText ?? 'Cancel'}
                            </button>
                            <button
                                type="button"
                                ref={confirmBtnRef}
                                onClick={() => onClose(true)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm transition-colors ${
                                    pending.opts.destructive
                                        ? 'bg-red-500 hover:bg-red-600'
                                        : 'bg-slate-950 hover:bg-slate-800'
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
