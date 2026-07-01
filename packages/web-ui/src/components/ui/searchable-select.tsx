import {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type ReactNode,
} from 'react';
import { CaretDown, Check, MagnifyingGlass } from '@phosphor-icons/react';
import { Command } from 'cmdk';
import { Popover as PopoverPrimitive } from 'radix-ui';

import { cn } from '../ai-elements/utils';
import type { SelectOption, SelectValue } from './select';

export function searchableSelectText(node: ReactNode): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(searchableSelectText).join(' ');
    return '';
}

export interface SearchableSelectProps<Value extends SelectValue = string> {
    ariaLabel: string;
    emptyMessage: string;
    listboxLabel?: string;
    onValueChange: (value: Value, option: SelectOption<Value>) => void;
    options: SelectOption<Value>[];
    placeholder?: string;
    searchAriaLabel: string;
    searchPlaceholder?: string;
    value?: Value;
    commandLabel?: string;
    contentClassName?: string;
    contentWidth?: string;
    listClassName?: string;
    searchInputClassName?: string;
    triggerClassName?: string;
    triggerLabel?: ReactNode;
    matchTriggerWidth?: boolean;
}

export function SearchableSelect<Value extends SelectValue = string>({
    ariaLabel,
    commandLabel,
    contentClassName,
    contentWidth = 'min(360px, calc(100vw - 24px))',
    emptyMessage,
    listboxLabel,
    listClassName,
    matchTriggerWidth = false,
    onValueChange,
    options,
    placeholder = 'Select option',
    searchAriaLabel,
    searchInputClassName,
    searchPlaceholder = 'Search...',
    triggerClassName,
    triggerLabel,
    value,
}: SearchableSelectProps<Value>) {
    const listId = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const selectedOption = useMemo(
        () => options.find((option) => String(option.value) === String(value)),
        [options, value],
    );
    const selectedLabel = triggerLabel ?? (
        selectedOption
            ? searchableSelectText(selectedOption.label) || String(selectedOption.value)
            : placeholder
    );

    useEffect(() => {
        if (!open) {
            setSearch('');
            return;
        }
        const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
        return () => window.cancelAnimationFrame(frame);
    }, [open]);

    const selectOption = useCallback((option: SelectOption<Value>) => {
        if (option.disabled) return;
        onValueChange(option.value, option);
        setOpen(false);
        setSearch('');
    }, [onValueChange]);

    const handleTriggerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
        }
    }, []);

    return (
        <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
            <PopoverPrimitive.Trigger asChild>
                <button
                    type="button"
                    role="combobox"
                    aria-label={ariaLabel}
                    aria-expanded={open}
                    aria-haspopup="listbox"
                    aria-controls={open ? listId : undefined}
                    disabled={options.length === 0}
                    onKeyDown={handleTriggerKeyDown}
                    className={cn(
                        'clash-select-trigger inline-flex min-w-0 items-center gap-1.5 rounded-xl border border-warm-border bg-warm-surface px-3 py-2 text-xs font-medium text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] transition-colors hover:bg-warm-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface disabled:cursor-not-allowed disabled:opacity-45 dark:text-slate-50 dark:hover:bg-slate-800',
                        triggerClassName,
                    )}
                >
                    <span className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
                    <CaretDown className="h-3.5 w-3.5 flex-shrink-0 text-stone-500 dark:text-stone-400" aria-hidden="true" />
                </button>
            </PopoverPrimitive.Trigger>
            <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content
                    align="start"
                    sideOffset={8}
                    collisionPadding={12}
                    onOpenAutoFocus={(event) => {
                        event.preventDefault();
                        inputRef.current?.focus();
                    }}
                    className={cn(
                        'z-[90] overflow-hidden rounded-2xl border border-warm-border/90 bg-warm-surface shadow-[0_18px_48px_rgba(35,31,25,0.14)] dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_18px_48px_rgba(0,0,0,0.36)]',
                        contentClassName,
                    )}
                    style={{
                        width: matchTriggerWidth
                            ? 'min(var(--radix-popover-trigger-width), calc(100vw - 24px))'
                            : contentWidth,
                    }}
                >
                    <Command label={commandLabel ?? searchAriaLabel} className="w-full">
                        <div className="border-b border-warm-border/80 p-2 dark:border-slate-700">
                            <div className="relative">
                                <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
                                <Command.Input
                                    ref={inputRef}
                                    aria-label={searchAriaLabel}
                                    value={search}
                                    onValueChange={setSearch}
                                    placeholder={searchPlaceholder}
                                    className={searchInputClassName}
                                />
                            </div>
                        </div>
                        <Command.List
                            id={listId}
                            label={listboxLabel ?? ariaLabel}
                            className={cn('max-h-72 overflow-y-auto p-1.5', listClassName)}
                        >
                            <Command.Empty className="px-3 py-5 text-center text-xs font-medium text-stone-500 dark:text-stone-400">
                                {emptyMessage}
                            </Command.Empty>
                            <Command.Group>
                                {options.map((option) => {
                                    const optionLabel = searchableSelectText(option.label) || String(option.value);
                                    const description = searchableSelectText(option.description);
                                    const selected = String(option.value) === String(value);
                                    return (
                                        <Command.Item
                                            key={String(option.value)}
                                            value={String(option.value)}
                                            keywords={[optionLabel, description, String(option.value)].filter(Boolean)}
                                            disabled={option.disabled}
                                            onSelect={() => selectOption(option)}
                                            className={cn(
                                                'flex min-h-[42px] w-full cursor-default items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors outline-none',
                                                selected
                                                    ? 'bg-warm-muted/80 text-slate-950 dark:bg-slate-800 dark:text-slate-50'
                                                    : 'text-slate-900 data-[selected=true]:bg-warm-muted/75 dark:text-slate-100 dark:data-[selected=true]:bg-slate-800/80',
                                                option.disabled && 'opacity-45',
                                            )}
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
                                            <Check
                                                className={cn(
                                                    'h-4 w-4 flex-shrink-0 text-slate-700 transition-opacity dark:text-slate-200',
                                                    selected ? 'opacity-100' : 'opacity-0',
                                                )}
                                                aria-hidden="true"
                                            />
                                        </Command.Item>
                                    );
                                })}
                            </Command.Group>
                        </Command.List>
                    </Command>
                </PopoverPrimitive.Content>
            </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
    );
}
