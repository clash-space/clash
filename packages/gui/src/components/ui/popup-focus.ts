import { useCallback, useEffect, useRef, useState, type FocusEvent, type Ref, type RefObject } from 'react';

type AutoFocusEvent = {
    defaultPrevented: boolean;
    preventDefault: () => void;
};

type FocusOutsideEvent = AutoFocusEvent & { target: EventTarget | null };

const KEYBOARD_OPEN_KEYS = new Set(['Enter', ' ', 'ArrowDown', 'ArrowUp']);
const openPopupClosers = new Map<symbol, () => void>();

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
    if (typeof ref === 'function') ref(value);
    else if (ref) ref.current = value;
}

/**
 * Shared focus contract for portalled canvas popups.
 *
 * Pointer-opened popups keep the trigger as the stable focus owner, avoiding
 * a portal stealing focus from the canvas/node that launched it. Keyboard-
 * opened popups retain the primitive's native roving-focus behavior. Closing
 * always restores the trigger without scrolling the canvas.
 */
export function usePopupFocusPolicy<T extends HTMLElement>() {
    const triggerRef = useRef<T | null>(null);
    const openedByPointerRef = useRef(false);

    const composeTriggerRef = useCallback((forwardedRef?: Ref<T>) => (node: T | null) => {
        triggerRef.current = node;
        assignRef(forwardedRef, node);
    }, []);

    const markPointerOpen = useCallback(() => {
        openedByPointerRef.current = true;
    }, []);

    const markKeyboardOpen = useCallback((key: string) => {
        if (KEYBOARD_OPEN_KEYS.has(key)) openedByPointerRef.current = false;
    }, []);

    const restoreTriggerFocus = useCallback(() => {
        triggerRef.current?.focus({ preventScroll: true });
    }, []);

    const handleOpenAutoFocus = useCallback((event: AutoFocusEvent) => {
        if (!openedByPointerRef.current || event.defaultPrevented) return;
        event.preventDefault();
    }, []);

    const handleCloseAutoFocus = useCallback((event: AutoFocusEvent) => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        restoreTriggerFocus();
    }, [restoreTriggerFocus]);

    const handleContentFocusCapture = useCallback((event: FocusEvent<HTMLElement>) => {
        if (!openedByPointerRef.current) return;
        if (event.target === triggerRef.current) return;
        restoreTriggerFocus();
    }, [restoreTriggerFocus]);

    const handleFocusOutside = useCallback((event: FocusOutsideEvent) => {
        if (!openedByPointerRef.current || event.defaultPrevented) return;
        if (event.target === triggerRef.current) event.preventDefault();
    }, []);

    return {
        composeTriggerRef,
        handleCloseAutoFocus,
        handleContentFocusCapture,
        handleFocusOutside,
        handleOpenAutoFocus,
        markKeyboardOpen,
        markPointerOpen,
        triggerRef: triggerRef as RefObject<T | null>,
    };
}

/** Explicitly coordinates shared popups so focus retention is not secretly
 * responsible for closing a previously-open sibling. */
export function useExclusivePopupOpen({
    open: controlledOpen,
    defaultOpen = false,
    onOpenChange,
}: {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
}) {
    const idRef = useRef(Symbol('popup'));
    const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
    const open = controlledOpen ?? uncontrolledOpen;

    const commitOpen = useCallback((nextOpen: boolean) => {
        if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
        onOpenChange?.(nextOpen);
    }, [controlledOpen, onOpenChange]);

    const setOpen = useCallback((nextOpen: boolean) => {
        if (nextOpen) {
            for (const [id, close] of openPopupClosers) {
                if (id !== idRef.current) close();
            }
        }
        commitOpen(nextOpen);
    }, [commitOpen]);

    useEffect(() => {
        const id = idRef.current;
        if (!open) {
            openPopupClosers.delete(id);
            return;
        }
        openPopupClosers.set(id, () => commitOpen(false));
        return () => {
            openPopupClosers.delete(id);
        };
    }, [commitOpen, open]);

    return { open, setOpen };
}
