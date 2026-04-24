
import { useEffect, type RefObject } from 'react';

interface Options {
    open: boolean;
    onClose: () => void;
    /** Selector for initial focus target; defaults to first focusable element. */
    initialFocus?: string;
}

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Standard modal-dialog a11y: Escape to close, focus trap inside the dialog,
 * restore focus to the opener on unmount. Attach the returned behavior by
 * passing a ref to the dialog container (the element that wraps the dialog's
 * content — NOT the backdrop).
 *
 * Pair on the dialog container itself:
 *   role="dialog" aria-modal="true" aria-labelledby={headerId}
 */
export function useDialogA11y(containerRef: RefObject<HTMLElement | null>, { open, onClose, initialFocus }: Options): void {
    // Focus management on open/close
    useEffect(() => {
        if (!open) return;
        const container = containerRef.current;
        if (!container) return;

        const previouslyFocused = document.activeElement as HTMLElement | null;

        // Defer initial focus so portal-mounted content is in the DOM.
        const focusTimer = window.setTimeout(() => {
            const target = initialFocus
                ? container.querySelector<HTMLElement>(initialFocus)
                : container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
            target?.focus();
        }, 0);

        return () => {
            window.clearTimeout(focusTimer);
            // Restore focus to the opener if it's still in the document.
            if (previouslyFocused && document.body.contains(previouslyFocused)) {
                previouslyFocused.focus();
            }
        };
    }, [open, containerRef, initialFocus]);

    // Escape-to-close + tab trap
    useEffect(() => {
        if (!open) return;
        const container = containerRef.current;
        if (!container) return;

        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onClose();
                return;
            }
            if (e.key !== 'Tab') return;

            const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
                .filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1 && el.offsetParent !== null);
            if (focusables.length === 0) {
                e.preventDefault();
                return;
            }
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const active = document.activeElement as HTMLElement | null;

            if (e.shiftKey) {
                if (active === first || !container.contains(active)) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (active === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };

        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open, onClose, containerRef]);
}
