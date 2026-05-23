import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus management for dialogs. When `active` is true:
 *   - focuses the container on mount (initial announcement)
 *   - traps Tab/Shift+Tab inside the container
 *   - calls `onEscape` on Escape
 *   - restores focus to the previously-focused element on unmount
 *
 * Callers are still responsible for setting `role="dialog"`, `aria-modal`,
 * `aria-labelledby`, and `tabIndex={-1}` on the container.
 */
export function useFocusTrap(
    containerRef: RefObject<HTMLElement | null>,
    active: boolean,
    onEscape?: () => void,
) {
    useEffect(() => {
        if (!active) return;
        const previouslyFocused = document.activeElement as HTMLElement | null;
        containerRef.current?.focus();

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && onEscape) {
                e.preventDefault();
                onEscape();
                return;
            }
            if (e.key !== 'Tab' || !containerRef.current) return;
            const focusables = containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const activeEl = document.activeElement as HTMLElement | null;
            if (e.shiftKey && activeEl === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && activeEl === last) {
                e.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            previouslyFocused?.focus?.();
        };
    }, [active, containerRef, onEscape]);
}
