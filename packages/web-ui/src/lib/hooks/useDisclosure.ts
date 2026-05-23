import { useCallback, useId, useState } from 'react';

/**
 * Headless disclosure (collapsible / accordion / expandable section).
 * Owns the a11y wiring — state, button/region IDs, ARIA attrs — so
 * callers just spread the resulting prop bags.
 *
 *   const { isOpen, triggerProps, panelProps } = useDisclosure();
 *   return (
 *     <>
 *       <button {...triggerProps}>Toggle</button>
 *       {isOpen && <div {...panelProps}>…</div>}
 *     </>
 *   );
 *
 * The trigger gets `type=button`, `aria-expanded`, `aria-controls`, and
 * an `onClick` that toggles. The panel gets a matching `id` and
 * `role=region`. Conditionally render the panel for animation
 * (AnimatePresence etc.); the hook doesn't manage visibility itself.
 */
export function useDisclosure(initiallyOpen = false) {
    const [isOpen, setIsOpen] = useState(initiallyOpen);
    const panelId = useId();

    const open = useCallback(() => setIsOpen(true), []);
    const close = useCallback(() => setIsOpen(false), []);
    const toggle = useCallback(() => setIsOpen((v) => !v), []);

    const triggerProps = {
        type: 'button' as const,
        'aria-expanded': isOpen,
        'aria-controls': panelId,
        onClick: toggle,
    };

    const panelProps = {
        id: panelId,
        role: 'region' as const,
    };

    return { isOpen, open, close, toggle, triggerProps, panelProps };
}
