import { useId, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from '@phosphor-icons/react';
import { useFocusTrap } from '@clash/web-ui/lib/hooks/useFocusTrap';

export interface DialogProps {
    open: boolean;
    onClose: () => void;
    /** Heading text rendered as h2 and wired to aria-labelledby.
     *  Optional: if absent, the dialog renders no header chrome (close
     *  button still shown unless hidden). In that mode the caller MUST
     *  pass `ariaLabel` so the dialog still has an accessible name. */
    title?: string;
    /** Required when `title` is absent — becomes the dialog's aria-label. */
    ariaLabel?: string;
    /** Optional supporting copy below the title. Wired to aria-describedby. */
    description?: ReactNode;
    children: ReactNode;
    /** Max width preset. sm=420, md=520, lg=640, xl=full-content. Default md. */
    size?: 'sm' | 'md' | 'lg' | 'xl';
    /** Hide the top-right close X. Default false (shown). */
    hideCloseButton?: boolean;
    /** Disable backdrop-click-to-close (Escape still works). Default false. */
    disableBackdropClose?: boolean;
    /** Strip the rounded card chrome — caller owns its own layout
     *  (sidebar + content, etc). Default false. */
    unstyled?: boolean;
}

const sizeClasses = {
    sm: 'w-[420px]',
    md: 'w-[520px]',
    lg: 'w-[640px]',
    xl: 'w-full max-w-5xl h-[min(720px,85vh)]',
};

/**
 * App-wide modal dialog. Owns the a11y wiring (role=dialog, aria-modal,
 * aria-labelledby/describedby, focus trap, Escape, focus restoration on
 * close) so callers don't have to remember each piece.
 *
 * Pattern: spring-scale entry + backdrop fade. Backdrop click closes by
 * default; Escape always closes. Returns focus to the previously focused
 * element on close (handled by useFocusTrap).
 */
export function Dialog({
    open,
    onClose,
    title,
    ariaLabel,
    description,
    children,
    size = 'md',
    hideCloseButton = false,
    disableBackdropClose = false,
    unstyled = false,
}: DialogProps) {
    const titleId = useId();
    const descId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    useFocusTrap(dialogRef, open, onClose);

    if (process.env.NODE_ENV !== 'production' && !title && !ariaLabel) {
        // eslint-disable-next-line no-console
        console.warn('<Dialog> needs either `title` or `ariaLabel` for an accessible name.');
    }

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
                    onClick={disableBackdropClose ? undefined : onClose}
                >
                    <motion.div
                        ref={dialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={title ? titleId : undefined}
                        aria-label={!title ? ariaLabel : undefined}
                        aria-describedby={description ? descId : undefined}
                        tabIndex={-1}
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 340, damping: 32 }}
                        className={
                            unstyled
                                ? `relative ${sizeClasses[size]} max-w-[92vw] focus:outline-none`
                                : `relative ${sizeClasses[size]} max-w-[92vw] max-h-[85vh] overflow-y-auto rounded-2xl bg-warm-surface border border-warm-border shadow-xl p-6 focus:outline-none`
                        }
                        onClick={(e) => e.stopPropagation()}
                    >
                        {!hideCloseButton && !unstyled && (
                            <button
                                type="button"
                                aria-label="Close"
                                onClick={onClose}
                                className="absolute top-3 right-3 p-2 min-h-[36px] min-w-[36px] rounded-md text-stone-700 hover:text-stone-900 hover:bg-warm-muted transition-colors dark:text-stone-300 dark:hover:text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface"
                            >
                                <X className="w-4 h-4" weight="bold" aria-hidden="true" />
                            </button>
                        )}
                        {title && (
                            <h2 id={titleId} className="font-display text-lg font-bold text-slate-900 mb-1 dark:text-slate-50 pr-8">
                                {title}
                            </h2>
                        )}
                        {description && (
                            <div id={descId} className="text-sm text-stone-700 mb-5 dark:text-stone-300">
                                {description}
                            </div>
                        )}
                        {children}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
