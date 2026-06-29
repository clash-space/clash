import {
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ButtonHTMLAttributes,
    type CSSProperties,
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { CaretDown, CaretLeft, CaretRight, Check } from '@phosphor-icons/react';

import { cn } from '../ai-elements/utils';

export type SelectValue = string | number | boolean;

export interface SelectOption<Value extends SelectValue = string> {
    value: Value;
    label: ReactNode;
    description?: ReactNode;
    icon?: ReactNode;
    disabled?: boolean;
    selected?: boolean;
    rightAdornment?: ReactNode;
    hasSubmenu?: boolean;
    submenuLabel?: ReactNode;
    submenuSections?: SelectSection<Value>[];
}

export interface SelectSection<Value extends SelectValue = string> {
    id: string;
    label?: ReactNode;
    options: SelectOption<Value>[];
}

type SelectAnchor = {
    left: number;
    width: number;
    maxHeight: number;
    top?: number;
    bottom?: number;
    transformOrigin: string;
};

type FloatingMenuAnchorRef = RefObject<HTMLElement | null>;

export interface FloatingMenuProps {
    anchorRef: FloatingMenuAnchorRef;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    ariaLabel: string;
    id?: string;
    children: ReactNode;
    align?: 'start' | 'end';
    placement?: 'top' | 'bottom' | 'auto';
    menuWidth?: number | 'trigger' | 'auto';
    maxMenuHeight?: number;
    allowOverflow?: boolean;
    stopPropagation?: boolean;
    className?: string;
}

export interface SelectMenuProps<Value extends SelectValue = string> {
    value: Value;
    options?: SelectOption<Value>[];
    sections?: SelectSection<Value>[];
    onValueChange: (value: Value, option: SelectOption<Value>) => void;
    ariaLabel: string;
    placeholder?: ReactNode;
    triggerLabel?: ReactNode;
    triggerPrefix?: ReactNode;
    triggerSuffix?: ReactNode;
    title?: string;
    disabled?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    variant?: 'inline' | 'pill' | 'field';
    size?: 'sm' | 'md';
    align?: 'start' | 'end';
    placement?: 'top' | 'bottom' | 'auto';
    menuWidth?: number | 'trigger' | 'auto';
    maxMenuHeight?: number;
    submenuMode?: 'drilldown' | 'flyout';
    submenuWidth?: number;
    showCaret?: boolean;
    stopPropagation?: boolean;
    className?: string;
    triggerClassName?: string;
    menuClassName?: string;
}

const VIEWPORT_MARGIN = 12;
const MENU_OFFSET = 8;

const triggerVariantClasses = {
    inline:
        'h-9 max-w-full justify-start rounded-md bg-transparent px-1.5 text-sm font-semibold text-slate-800 hover:text-slate-950 dark:text-slate-100 dark:hover:text-white',
    pill:
        'h-9 justify-between rounded-2xl border border-warm-border/80 bg-warm-surface px-3 text-sm font-medium text-slate-900 shadow-[0_1px_2px_rgba(35,31,25,0.06)] hover:bg-warm-muted/65 dark:text-slate-50 dark:hover:bg-slate-800',
    field:
        'min-h-[34px] w-full justify-between rounded-xl border border-warm-border bg-warm-surface px-3 py-2 text-xs font-medium text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] hover:bg-warm-muted/45 dark:text-slate-50 dark:hover:bg-slate-800',
};

const triggerSizeClasses = {
    sm: 'min-h-[32px]',
    md: '',
};

function sameValue(a: SelectValue, b: SelectValue) {
    return String(a) === String(b);
}

function calculateAnchor(
    rect: DOMRect,
    {
        align,
        maxMenuHeight,
        menuWidth,
        placement,
    }: Required<Pick<FloatingMenuProps, 'align' | 'maxMenuHeight' | 'menuWidth' | 'placement'>>,
): SelectAnchor {
    const naturalWidth =
        menuWidth === 'trigger'
            ? rect.width
            : typeof menuWidth === 'number'
                ? menuWidth
                : Math.max(rect.width, 248);
    const width = Math.min(naturalWidth, window.innerWidth - VIEWPORT_MARGIN * 2);
    const unclampedLeft = align === 'end' ? rect.right - width : rect.left;
    const left = Math.min(
        Math.max(unclampedLeft, VIEWPORT_MARGIN),
        window.innerWidth - width - VIEWPORT_MARGIN,
    );
    const availableAbove = Math.max(0, rect.top - VIEWPORT_MARGIN - MENU_OFFSET);
    const availableBelow = Math.max(0, window.innerHeight - rect.bottom - VIEWPORT_MARGIN - MENU_OFFSET);
    const useTop =
        placement === 'top' ||
        (placement === 'auto' && availableAbove > availableBelow && availableAbove >= 140);

    return {
        left,
        width,
        maxHeight: Math.max(120, Math.min(maxMenuHeight, useTop ? availableAbove : availableBelow)),
        top: useTop ? undefined : Math.min(rect.bottom + MENU_OFFSET, window.innerHeight - VIEWPORT_MARGIN),
        bottom: useTop ? Math.max(window.innerHeight - rect.top + MENU_OFFSET, VIEWPORT_MARGIN) : undefined,
        transformOrigin: useTop ? 'bottom left' : 'top left',
    };
}

export function menuItemClassName({
    selected = false,
    disabled = false,
    className,
}: {
    selected?: boolean;
    disabled?: boolean;
    className?: string;
} = {}) {
    return cn(
        'flex min-h-[40px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand',
        selected
            ? 'text-slate-950 hover:bg-warm-muted/75 dark:text-slate-50 dark:hover:bg-slate-800/80'
            : 'text-slate-900 hover:bg-warm-muted/75 dark:text-slate-100 dark:hover:bg-slate-800/80',
        disabled && 'cursor-not-allowed opacity-45',
        className,
    );
}

export function MenuItemButton({
    children,
    selected = false,
    disabled = false,
    className,
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
    selected?: boolean;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            className={menuItemClassName({ selected, disabled, className })}
            {...props}
        >
            {children}
        </button>
    );
}

export function FloatingMenu({
    anchorRef,
    open,
    onOpenChange,
    ariaLabel,
    id,
    children,
    align = 'start',
    placement = 'auto',
    menuWidth = 'auto',
    maxMenuHeight = 320,
    allowOverflow = false,
    stopPropagation = false,
    className,
}: FloatingMenuProps) {
    const generatedId = useId();
    const menuId = id ?? generatedId;
    const menuRef = useRef<HTMLDivElement>(null);
    const [anchor, setAnchor] = useState<SelectAnchor | null>(null);

    const updateAnchor = useCallback(() => {
        if (typeof window === 'undefined') return;
        const rect = anchorRef.current?.getBoundingClientRect();
        if (!rect) return;
        setAnchor(calculateAnchor(rect, { align, maxMenuHeight, menuWidth, placement }));
    }, [align, anchorRef, maxMenuHeight, menuWidth, placement]);

    useLayoutEffect(() => {
        if (!open) {
            setAnchor(null);
            return;
        }
        updateAnchor();
    }, [open, updateAnchor]);

    useEffect(() => {
        if (!open) return;

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (anchorRef.current?.contains(target) || menuRef.current?.contains(target)) return;
            onOpenChange(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onOpenChange(false);
                anchorRef.current?.focus();
            }
        };
        const handleReposition = () => updateAnchor();

        window.addEventListener('resize', handleReposition);
        window.addEventListener('scroll', handleReposition, true);
        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('resize', handleReposition);
            window.removeEventListener('scroll', handleReposition, true);
            document.removeEventListener('pointerdown', handlePointerDown, true);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [anchorRef, onOpenChange, open, updateAnchor]);

    const menuStyle: CSSProperties | undefined = anchor
        ? {
            left: anchor.left,
            width: anchor.width,
            maxHeight: anchor.maxHeight,
            transformOrigin: anchor.transformOrigin,
            ...(anchor.top !== undefined ? { top: anchor.top } : { bottom: anchor.bottom }),
        }
        : undefined;

    if (!open || !anchor || typeof document === 'undefined') return null;

    return createPortal(
        <motion.div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={ariaLabel}
            initial={{ opacity: 0, y: anchor.bottom !== undefined ? 8 : -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: anchor.bottom !== undefined ? 8 : -8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            style={menuStyle}
            className={cn(
                'fixed z-[80] rounded-2xl border border-warm-border/90 bg-warm-surface p-1.5 shadow-[0_18px_48px_rgba(35,31,25,0.14)]',
                allowOverflow ? 'overflow-visible' : 'overflow-y-auto',
                'dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_18px_48px_rgba(0,0,0,0.36)]',
                className,
            )}
            onClick={(event) => {
                if (stopPropagation) event.stopPropagation();
            }}
            onPointerDown={(event) => {
                if (stopPropagation) event.stopPropagation();
            }}
        >
            {children}
        </motion.div>,
        document.body,
    );
}

export function SelectMenu<Value extends SelectValue = string>({
    value,
    options,
    sections,
    onValueChange,
    ariaLabel,
    placeholder = 'Select',
    triggerLabel,
    triggerPrefix,
    triggerSuffix,
    title,
    disabled = false,
    open: controlledOpen,
    onOpenChange,
    variant = 'field',
    size = 'md',
    align = 'start',
    placement = 'auto',
    menuWidth = 'auto',
    maxMenuHeight = 320,
    submenuMode = 'drilldown',
    submenuWidth = 220,
    showCaret = true,
    stopPropagation = false,
    className,
    triggerClassName,
    menuClassName,
}: SelectMenuProps<Value>) {
    const listboxId = useId();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
    const [activeSubmenu, setActiveSubmenu] = useState<SelectOption<Value> | null>(null);
    const open = controlledOpen ?? uncontrolledOpen;
    const flyoutEnabled = submenuMode === 'flyout';

    const normalizedSections = useMemo<SelectSection<Value>[]>(() => {
        if (sections) return sections;
        return [{ id: 'options', options: options ?? [] }];
    }, [options, sections]);

    const flatOptions = useMemo(
        () => normalizedSections.flatMap((section) => [
            ...section.options,
            ...section.options.flatMap((option) => option.submenuSections?.flatMap((submenu) => submenu.options) ?? []),
        ]),
        [normalizedSections],
    );
    const selectedOption = flatOptions.find((option) => option.selected ?? sameValue(option.value, value));
    const label = triggerLabel ?? selectedOption?.label ?? placeholder;
    const isDisabled = disabled || flatOptions.length === 0;

    const setOpen = useCallback(
        (nextOpen: boolean) => {
            if (controlledOpen === undefined) {
                setUncontrolledOpen(nextOpen);
            }
            if (!nextOpen) setActiveSubmenu(null);
            onOpenChange?.(nextOpen);
        },
        [controlledOpen, onOpenChange],
    );

    const handleTriggerClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
        if (stopPropagation) event.stopPropagation();
        if (isDisabled) return;
        setOpen(!open);
    };

    const handleTriggerPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (stopPropagation) event.stopPropagation();
    };

    const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
        }
    };

    return (
        <div className={cn('relative inline-flex min-w-0', className)}>
            <button
                ref={triggerRef}
                type="button"
                aria-label={ariaLabel}
                aria-expanded={open}
                aria-haspopup="menu"
                aria-controls={open ? listboxId : undefined}
                disabled={isDisabled}
                title={title}
                onClick={handleTriggerClick}
                onPointerDown={handleTriggerPointerDown}
                onKeyDown={handleTriggerKeyDown}
                className={cn(
                    'clash-select-trigger inline-flex min-w-0 items-center gap-1.5 transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface',
                    'disabled:cursor-not-allowed disabled:opacity-45',
                    triggerVariantClasses[variant],
                    triggerSizeClasses[size],
                    triggerClassName,
                )}
            >
                {triggerPrefix}
                <span className="min-w-0 flex-1 truncate text-left">{label}</span>
                {triggerSuffix}
                {showCaret ? <CaretDown className="h-3.5 w-3.5 flex-shrink-0 text-stone-500 dark:text-stone-400" aria-hidden="true" /> : null}
            </button>
            <FloatingMenu
                id={listboxId}
                anchorRef={triggerRef}
                open={open}
                onOpenChange={setOpen}
                ariaLabel={flyoutEnabled ? ariaLabel : String(activeSubmenu?.submenuLabel ?? activeSubmenu?.label ?? ariaLabel)}
                align={align}
                placement={placement}
                menuWidth={menuWidth}
                maxMenuHeight={maxMenuHeight}
                allowOverflow={flyoutEnabled}
                stopPropagation={stopPropagation}
                className={menuClassName}
            >
                {activeSubmenu && !flyoutEnabled ? (
                    <div>
                        <button
                            type="button"
                            role="menuitem"
                            onClick={(event) => {
                                if (stopPropagation) event.stopPropagation();
                                setActiveSubmenu(null);
                            }}
                            className={menuItemClassName({ className: 'min-h-[36px] text-stone-600 dark:text-stone-300' })}
                        >
                            <CaretLeft className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                            <span className="min-w-0 flex-1 truncate font-medium">{activeSubmenu.submenuLabel ?? activeSubmenu.label}</span>
                        </button>
                        <div role="separator" className="my-1.5 border-t border-warm-border/80 dark:border-slate-700" />
                        {(activeSubmenu.submenuSections ?? []).map((section, sectionIndex) => (
                            <SelectMenuSection
                                key={section.id}
                                section={section}
                                sectionIndex={sectionIndex}
                                value={value}
                                stopPropagation={stopPropagation}
                                submenuMode="drilldown"
                                activeSubmenu={null}
                                onSelect={(option) => {
                                    onValueChange(option.value, option);
                                    setOpen(false);
                                    triggerRef.current?.focus();
                                }}
                                onOpenSubmenu={setActiveSubmenu}
                            />
                        ))}
                    </div>
                ) : (
                    <div
                        className="relative"
                        onMouseLeave={() => {
                            if (flyoutEnabled) setActiveSubmenu(null);
                        }}
                    >
                        {normalizedSections.map((section, sectionIndex) => (
                            <SelectMenuSection
                                key={section.id}
                                section={section}
                                sectionIndex={sectionIndex}
                                value={value}
                                stopPropagation={stopPropagation}
                                submenuMode={submenuMode}
                                activeSubmenu={activeSubmenu}
                                onSelect={(option) => {
                                    onValueChange(option.value, option);
                                    setOpen(false);
                                    triggerRef.current?.focus();
                                }}
                                onOpenSubmenu={setActiveSubmenu}
                            />
                        ))}
                        {flyoutEnabled && activeSubmenu?.submenuSections?.length ? (
                            <motion.div
                                role="menu"
                                aria-label={String(activeSubmenu.submenuLabel ?? activeSubmenu.label)}
                                initial={{ opacity: 0, x: -6, scale: 0.98 }}
                                animate={{ opacity: 1, x: 0, scale: 1 }}
                                transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                                style={{ width: submenuWidth }}
                                className="absolute bottom-0 left-[calc(100%+8px)] rounded-2xl border border-warm-border/90 bg-warm-surface p-1.5 shadow-[0_18px_48px_rgba(35,31,25,0.14)] dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_18px_48px_rgba(0,0,0,0.36)]"
                            >
                                {(activeSubmenu.submenuSections ?? []).map((section, sectionIndex) => (
                                    <SelectMenuSection
                                        key={section.id}
                                        section={section}
                                        sectionIndex={sectionIndex}
                                        value={value}
                                        stopPropagation={stopPropagation}
                                        submenuMode="drilldown"
                                        activeSubmenu={null}
                                        onSelect={(option) => {
                                            onValueChange(option.value, option);
                                            setOpen(false);
                                            triggerRef.current?.focus();
                                        }}
                                        onOpenSubmenu={setActiveSubmenu}
                                    />
                                ))}
                            </motion.div>
                        ) : null}
                    </div>
                )}
            </FloatingMenu>
        </div>
    );
}

function SelectMenuSection<Value extends SelectValue>({
    section,
    sectionIndex,
    value,
    stopPropagation,
    submenuMode,
    activeSubmenu,
    onSelect,
    onOpenSubmenu,
}: {
    section: SelectSection<Value>;
    sectionIndex: number;
    value: Value;
    stopPropagation: boolean;
    submenuMode: 'drilldown' | 'flyout';
    activeSubmenu: SelectOption<Value> | null;
    onSelect: (option: SelectOption<Value>) => void;
    onOpenSubmenu: (option: SelectOption<Value>) => void;
}) {
    return (
        <div
            className={cn(sectionIndex > 0 && 'mt-1.5 border-t border-warm-border/80 pt-1.5 dark:border-slate-700')}
        >
            {section.label ? (
                <div className="px-3 pb-1 pt-1 text-sm font-medium text-stone-500 dark:text-stone-400">
                    {section.label}
                </div>
            ) : null}
            <div className="space-y-0.5">
                {section.options.map((option) => {
                    const selected = option.selected ?? sameValue(option.value, value);
                    const opensSubmenu = option.hasSubmenu || !!option.submenuSections;
                    const submenuActive = opensSubmenu && activeSubmenu?.value === option.value;
                    return (
                        <button
                            key={String(option.value)}
                            type="button"
                            role={opensSubmenu ? 'menuitem' : 'menuitemradio'}
                            aria-checked={opensSubmenu ? undefined : selected}
                            disabled={option.disabled}
                            onClick={(event) => {
                                if (stopPropagation) event.stopPropagation();
                                if (option.disabled) return;
                                if (opensSubmenu) {
                                    onOpenSubmenu(option);
                                    return;
                                }
                                onSelect(option);
                            }}
                            onMouseEnter={() => {
                                if (submenuMode === 'flyout' && opensSubmenu && !option.disabled) {
                                    onOpenSubmenu(option);
                                }
                            }}
                            className={menuItemClassName({ selected: selected || submenuActive, disabled: option.disabled })}
                        >
                            {option.icon ? (
                                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-slate-700 dark:text-slate-300" aria-hidden="true">
                                    {option.icon}
                                </span>
                            ) : null}
                            <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium leading-5">{option.label}</span>
                                {option.description ? (
                                    <span className="block truncate text-xs font-normal leading-4 text-stone-600 dark:text-stone-400">
                                        {option.description}
                                    </span>
                                ) : null}
                            </span>
                            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-stone-600 dark:text-stone-300" aria-hidden="true">
                                {option.rightAdornment ?? (
                                    opensSubmenu
                                        ? <CaretRight className="h-4 w-4" />
                                        : selected
                                            ? <Check className="h-4 w-4" weight="bold" />
                                            : null
                                )}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
