import {
    useCallback,
    useMemo,
    useState,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from 'react';
import { CaretDown, CaretRight, Check } from '@phosphor-icons/react';
import { DropdownMenu as DropdownMenuPrimitive, Select as SelectPrimitive } from 'radix-ui';

import { cn } from '../ai-elements/utils';
import { Tooltip } from './tooltip';

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

function menuItemClassName({
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

function DropdownSelectMenu<Value extends SelectValue = string>({
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
    submenuWidth = 220,
    showCaret = true,
    stopPropagation = false,
    className,
    triggerClassName,
    menuClassName,
}: SelectMenuProps<Value>) {
    const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
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
    const contentWidth =
        menuWidth === 'trigger'
            ? 'var(--radix-dropdown-menu-trigger-width)'
            : typeof menuWidth === 'number'
                ? `min(${menuWidth}px, calc(100vw - ${VIEWPORT_MARGIN * 2}px))`
                : undefined;

    const handleEventBoundary = (event: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>) => {
        if (stopPropagation) event.stopPropagation();
    };

    const handleOpenChange = useCallback((nextOpen: boolean) => {
        if (!nextOpen) setOpenSubmenu(null);
        onOpenChange?.(nextOpen);
    }, [onOpenChange]);

    const selectOption = useCallback((option: SelectOption<Value>) => {
        if (option.disabled) return;
        onValueChange(option.value, option);
    }, [onValueChange]);

    const trigger = (
        <DropdownMenuPrimitive.Trigger asChild>
            <button
                type="button"
                aria-label={ariaLabel}
                disabled={isDisabled}
                onClick={handleEventBoundary}
                onPointerDown={handleEventBoundary}
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
        </DropdownMenuPrimitive.Trigger>
    );

    return (
        <DropdownMenuPrimitive.Root
            open={controlledOpen}
            onOpenChange={handleOpenChange}
        >
            <div className={cn('relative inline-flex min-w-0', className)}>
                {title ? <Tooltip label={title}>{trigger}</Tooltip> : trigger}
            </div>
            <DropdownMenuPrimitive.Portal>
                <DropdownMenuPrimitive.Content
                    aria-label={ariaLabel}
                    side={placement === 'top' ? 'top' : 'bottom'}
                    align={align}
                    sideOffset={MENU_OFFSET}
                    collisionPadding={VIEWPORT_MARGIN}
                    style={{
                        width: contentWidth,
                        maxHeight: `min(var(--radix-dropdown-menu-content-available-height), ${maxMenuHeight}px)`,
                    }}
                    className={cn(
                        'z-[80] overflow-hidden rounded-2xl border border-warm-border/90 bg-warm-surface shadow-[0_18px_48px_rgba(35,31,25,0.14)]',
                        'dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_18px_48px_rgba(0,0,0,0.36)]',
                        menuWidth === 'auto' && 'min-w-[min(var(--radix-dropdown-menu-trigger-width),calc(100vw-24px))]',
                        menuClassName,
                    )}
                    onClick={handleEventBoundary}
                    onPointerDown={handleEventBoundary}
                >
                    <div className="max-h-[inherit] overflow-y-auto p-1.5">
                        {normalizedSections.map((section, sectionIndex) => (
                            <DropdownSelectMenuSection
                                key={section.id}
                                section={section}
                                sectionIndex={sectionIndex}
                                value={value}
                                selectOption={selectOption}
                                openSubmenu={openSubmenu}
                                setOpenSubmenu={setOpenSubmenu}
                                submenuWidth={submenuWidth}
                            />
                        ))}
                    </div>
                </DropdownMenuPrimitive.Content>
            </DropdownMenuPrimitive.Portal>
        </DropdownMenuPrimitive.Root>
    );
}

function RadixSelectMenu<Value extends SelectValue = string>({
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
    showCaret = true,
    stopPropagation = false,
    className,
    triggerClassName,
    menuClassName,
}: SelectMenuProps<Value>) {
    const normalizedSections = useMemo<SelectSection<Value>[]>(() => {
        if (sections) return sections;
        return [{ id: 'options', options: options ?? [] }];
    }, [options, sections]);
    const flatOptions = useMemo(
        () => normalizedSections.flatMap((section) => section.options),
        [normalizedSections],
    );
    const selectedOption = flatOptions.find((option) => option.selected ?? sameValue(option.value, value));
    const selectedStringValue = selectedOption ? String(selectedOption.value) : String(value);
    const label = triggerLabel ?? selectedOption?.label ?? placeholder;
    const isDisabled = disabled || flatOptions.length === 0;
    const contentWidth =
        menuWidth === 'trigger'
            ? 'var(--radix-select-trigger-width)'
            : typeof menuWidth === 'number'
                ? `min(${menuWidth}px, calc(100vw - ${VIEWPORT_MARGIN * 2}px))`
                : undefined;

    const handleValueChange = useCallback((nextValue: string) => {
        const option = flatOptions.find((candidate) => String(candidate.value) === nextValue);
        if (!option || option.disabled) return;
        onValueChange(option.value, option);
    }, [flatOptions, onValueChange]);

    const handleEventBoundary = (event: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>) => {
        if (stopPropagation) event.stopPropagation();
    };

    const trigger = (
        <SelectPrimitive.Trigger
            aria-label={ariaLabel}
            onClick={handleEventBoundary}
            onPointerDown={handleEventBoundary}
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
            {showCaret ? (
                <SelectPrimitive.Icon asChild>
                    <CaretDown className="h-3.5 w-3.5 flex-shrink-0 text-stone-500 dark:text-stone-400" aria-hidden="true" />
                </SelectPrimitive.Icon>
            ) : null}
        </SelectPrimitive.Trigger>
    );

    return (
        <SelectPrimitive.Root
            value={selectedStringValue}
            open={controlledOpen}
            onOpenChange={onOpenChange}
            onValueChange={handleValueChange}
            disabled={isDisabled}
        >
            <div className={cn('relative inline-flex min-w-0', className)}>
                {title ? <Tooltip label={title}>{trigger}</Tooltip> : trigger}
            </div>
            <SelectPrimitive.Portal>
                <SelectPrimitive.Content
                    aria-label={ariaLabel}
                    position="popper"
                    side={placement === 'top' ? 'top' : 'bottom'}
                    align={align}
                    sideOffset={MENU_OFFSET}
                    collisionPadding={VIEWPORT_MARGIN}
                    style={{
                        width: contentWidth,
                        maxHeight: `min(var(--radix-select-content-available-height), ${maxMenuHeight}px)`,
                    }}
                    className={cn(
                        'z-[80] overflow-hidden rounded-2xl border border-warm-border/90 bg-warm-surface shadow-[0_18px_48px_rgba(35,31,25,0.14)]',
                        'dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_18px_48px_rgba(0,0,0,0.36)]',
                        menuWidth === 'auto' && 'min-w-[min(var(--radix-select-trigger-width),calc(100vw-24px))]',
                        menuClassName,
                    )}
                    onClick={handleEventBoundary}
                    onPointerDown={handleEventBoundary}
                >
                    <SelectPrimitive.Viewport className="max-h-[inherit] overflow-y-auto p-1.5">
                        {normalizedSections.map((section, sectionIndex) => (
                            <SelectPrimitive.Group
                                key={section.id}
                                className={cn(sectionIndex > 0 && 'mt-1.5 border-t border-warm-border/80 pt-1.5 dark:border-slate-700')}
                            >
                                {section.label ? (
                                    <SelectPrimitive.Label className="px-3 pb-1 pt-1 text-sm font-medium text-stone-500 dark:text-stone-400">
                                        {section.label}
                                    </SelectPrimitive.Label>
                                ) : null}
                                <div className="space-y-0.5">
                                    {section.options.map((option) => {
                                        const selected = option.selected ?? sameValue(option.value, value);
                                        const textValue = typeof option.label === 'string' ? option.label : undefined;
                                        return (
                                            <SelectPrimitive.Item
                                                key={String(option.value)}
                                                value={String(option.value)}
                                                disabled={option.disabled}
                                                textValue={textValue}
                                                className={menuItemClassName({ selected, disabled: option.disabled })}
                                            >
                                                {option.icon ? (
                                                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-slate-700 dark:text-slate-300" aria-hidden="true">
                                                        {option.icon}
                                                    </span>
                                                ) : null}
                                                <span className="min-w-0 flex-1">
                                                    <SelectPrimitive.ItemText>
                                                        <span className="block truncate font-medium leading-5">{option.label}</span>
                                                    </SelectPrimitive.ItemText>
                                                    {option.description ? (
                                                        <span className="block truncate text-xs font-normal leading-4 text-stone-600 dark:text-stone-400">
                                                            {option.description}
                                                        </span>
                                                    ) : null}
                                                </span>
                                                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-stone-600 dark:text-stone-300" aria-hidden="true">
                                                    {option.rightAdornment ?? (
                                                        <SelectPrimitive.ItemIndicator>
                                                            <Check className="h-4 w-4" weight="bold" />
                                                        </SelectPrimitive.ItemIndicator>
                                                    )}
                                                </span>
                                            </SelectPrimitive.Item>
                                        );
                                    })}
                                </div>
                            </SelectPrimitive.Group>
                        ))}
                    </SelectPrimitive.Viewport>
                </SelectPrimitive.Content>
            </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
    );
}

function DropdownSelectMenuSection<Value extends SelectValue>({
    section,
    sectionIndex,
    value,
    selectOption,
    openSubmenu,
    setOpenSubmenu,
    submenuWidth,
}: {
    section: SelectSection<Value>;
    sectionIndex: number;
    value: Value;
    selectOption: (option: SelectOption<Value>) => void;
    openSubmenu: string | null;
    setOpenSubmenu: (value: string | null) => void;
    submenuWidth: number;
}) {
    const selectedSectionValue = section.options.find((option) => option.selected ?? sameValue(option.value, value))?.value;

    return (
        <DropdownMenuPrimitive.Group
            className={cn(sectionIndex > 0 && 'mt-1.5 border-t border-warm-border/80 pt-1.5 dark:border-slate-700')}
        >
            {section.label ? (
                <DropdownMenuPrimitive.Label className="px-3 pb-1 pt-1 text-sm font-medium text-stone-500 dark:text-stone-400">
                    {section.label}
                </DropdownMenuPrimitive.Label>
            ) : null}
            <DropdownMenuPrimitive.RadioGroup
                value={selectedSectionValue === undefined ? undefined : String(selectedSectionValue)}
                className="space-y-0.5"
            >
                {section.options.map((option) => {
                    const selected = option.selected ?? sameValue(option.value, value);
                    const opensSubmenu = option.hasSubmenu || !!option.submenuSections?.length;
                    const submenuKey = String(option.value);
                    if (opensSubmenu) {
                        return (
                            <DropdownMenuPrimitive.Sub
                                key={submenuKey}
                                open={openSubmenu === submenuKey}
                                onOpenChange={(open) => setOpenSubmenu(open ? submenuKey : null)}
                            >
                                <DropdownMenuPrimitive.SubTrigger
                                    disabled={option.disabled}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        if (!option.disabled) setOpenSubmenu(submenuKey);
                                    }}
                                    onMouseEnter={() => {
                                        if (!option.disabled) setOpenSubmenu(submenuKey);
                                    }}
                                    className={menuItemClassName({ selected: selected || openSubmenu === submenuKey, disabled: option.disabled })}
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
                                        {option.rightAdornment ?? <CaretRight className="h-4 w-4" />}
                                    </span>
                                </DropdownMenuPrimitive.SubTrigger>
                                <DropdownMenuPrimitive.Portal>
                                    <DropdownMenuPrimitive.SubContent
                                        aria-label={String(option.submenuLabel ?? option.label)}
                                        sideOffset={MENU_OFFSET}
                                        collisionPadding={VIEWPORT_MARGIN}
                                        style={{ width: submenuWidth }}
                                        className="z-[90] overflow-hidden rounded-2xl border border-warm-border/90 bg-warm-surface shadow-[0_18px_48px_rgba(35,31,25,0.14)] dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_18px_48px_rgba(0,0,0,0.36)]"
                                    >
                                        <div className="max-h-[min(var(--radix-dropdown-menu-content-available-height),320px)] overflow-y-auto p-1.5">
                                            {(option.submenuSections ?? []).map((submenuSection, submenuIndex) => (
                                                <DropdownSelectMenuSection
                                                    key={submenuSection.id}
                                                    section={submenuSection}
                                                    sectionIndex={submenuIndex}
                                                    value={value}
                                                    selectOption={selectOption}
                                                    openSubmenu={openSubmenu}
                                                    setOpenSubmenu={setOpenSubmenu}
                                                    submenuWidth={submenuWidth}
                                                />
                                            ))}
                                        </div>
                                    </DropdownMenuPrimitive.SubContent>
                                </DropdownMenuPrimitive.Portal>
                            </DropdownMenuPrimitive.Sub>
                        );
                    }

                    return (
                        <DropdownMenuPrimitive.RadioItem
                            key={String(option.value)}
                            value={String(option.value)}
                            disabled={option.disabled}
                            onSelect={() => selectOption(option)}
                            className={menuItemClassName({ selected, disabled: option.disabled })}
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
                                    <DropdownMenuPrimitive.ItemIndicator>
                                        <Check className="h-4 w-4" weight="bold" />
                                    </DropdownMenuPrimitive.ItemIndicator>
                                )}
                            </span>
                        </DropdownMenuPrimitive.RadioItem>
                    );
                })}
            </DropdownMenuPrimitive.RadioGroup>
        </DropdownMenuPrimitive.Group>
    );
}

function hasSubmenuOptions<Value extends SelectValue>(
    options?: SelectOption<Value>[],
    sections?: SelectSection<Value>[],
) {
    const sectionOptions = sections?.flatMap((section) => section.options) ?? options ?? [];
    return sectionOptions.some((option) => option.hasSubmenu || !!option.submenuSections?.length);
}

export function SelectMenu<Value extends SelectValue = string>(props: SelectMenuProps<Value>) {
    if (hasSubmenuOptions(props.options, props.sections)) {
        return <DropdownSelectMenu {...props} />;
    }
    return <RadixSelectMenu {...props} />;
}
