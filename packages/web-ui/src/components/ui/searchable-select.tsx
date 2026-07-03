import {
    Children,
    isValidElement,
    useCallback,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import { CaretDown, Check, MagnifyingGlass } from '@phosphor-icons/react';
import {
    Combobox,
    ComboboxItem,
    ComboboxList,
    ComboboxProvider,
    Select,
    SelectItem,
    SelectPopover,
    SelectProvider,
} from '@ariakit/react';

import { cn } from '../ai-elements/utils';
import type { SelectOption, SelectValue } from './select';

export function searchableSelectText(node: ReactNode): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(searchableSelectText).join(' ');
    if (isValidElement<{ children?: ReactNode }>(node)) {
        return Children.toArray(node.props.children).map(searchableSelectText).join(' ');
    }
    return '';
}

export interface SearchableSelectProps<Value extends SelectValue = string> {
    ariaLabel: string;
    emptyMessage: string;
    listboxLabel?: string;
    onValueChange: (value: Value, option: SelectOption<Value>) => void;
    options: SelectOption<Value>[];
    placeholder?: string;
    searchAriaLabel?: string;
    searchPlaceholder?: string;
    value?: Value;
    contentClassName?: string;
    contentWidth?: string;
    listClassName?: string;
    searchInputClassName?: string;
    triggerClassName?: string;
    triggerLabel?: ReactNode;
    matchTriggerWidth?: boolean;
}

function normalizeSearchText(value: string): string {
    return value.trim().toLowerCase();
}

function optionSearchText<Value extends SelectValue>(option: SelectOption<Value>): string {
    return [
        searchableSelectText(option.label),
        searchableSelectText(option.description),
        String(option.value),
    ].filter(Boolean).join(' ');
}

export function SearchableSelect<Value extends SelectValue = string>({
    ariaLabel,
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
    const selectedOption = useMemo(
        () => options.find((option) => String(option.value) === String(value)),
        [options, value],
    );
    const selectedLabel = triggerLabel ?? (
        selectedOption
            ? searchableSelectText(selectedOption.label) || String(selectedOption.value)
            : ''
    );
    const selectedStringValue = selectedOption ? String(selectedOption.value) : '';
    const [inputValue, setInputValue] = useState('');
    const filteredOptions = useMemo(() => {
        const query = normalizeSearchText(inputValue);
        if (!query) return options;
        return options.filter((option) => normalizeSearchText(optionSearchText(option)).includes(query));
    }, [inputValue, options]);

    const handleSelectedValueChange = useCallback((candidate: string) => {
        const option = options.find((item) => String(item.value) === String(candidate));
        if (!option || option.disabled) return;
        onValueChange(option.value, option);
    }, [onValueChange, options]);

    return (
        <ComboboxProvider
            resetValueOnHide
            value={inputValue}
            setValue={setInputValue}
        >
            <SelectProvider
                value={selectedStringValue}
                setValue={handleSelectedValueChange}
            >
                <Select
                    aria-label={ariaLabel}
                    disabled={options.length === 0}
                    className={cn(
                        'clash-select-trigger flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-warm-border bg-warm-surface px-3 py-2 text-sm font-medium text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] transition-colors hover:bg-warm-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface disabled:cursor-not-allowed disabled:opacity-45 dark:text-slate-50 dark:hover:bg-slate-800',
                        triggerClassName,
                    )}
                >
                    <span className={cn(
                        'min-w-0 flex-1 truncate text-left',
                        !selectedOption && 'text-stone-400 dark:text-stone-500',
                    )}>
                        {selectedOption ? selectedLabel : placeholder}
                    </span>
                    <CaretDown className="h-3.5 w-3.5 flex-shrink-0 text-stone-500" aria-hidden="true" />
                </Select>
                <SelectPopover
                    aria-label={listboxLabel ?? ariaLabel}
                    gutter={8}
                    overflowPadding={12}
                    sameWidth={matchTriggerWidth}
                    fitViewport
                    portal
                    className={cn(
                        'z-[90] max-h-[min(var(--popover-available-height),18rem)] overflow-y-auto rounded-2xl border border-warm-border/90 bg-warm-surface p-1.5 shadow-[0_18px_48px_rgba(35,31,25,0.14)] outline-none dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_18px_48px_rgba(0,0,0,0.36)]',
                        contentClassName,
                        listClassName,
                    )}
                    style={matchTriggerWidth ? undefined : { width: contentWidth }}
                >
                    <div className="sticky top-0 z-[1] bg-warm-surface p-1 dark:bg-slate-900">
                        <div className="relative min-w-0">
                            <MagnifyingGlass
                                className="pointer-events-none absolute left-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-stone-400"
                                aria-hidden="true"
                            />
                            <Combobox
                                aria-label={searchAriaLabel ?? `Search ${ariaLabel.toLowerCase()}`}
                                autoComplete="list"
                                autoSelect
                                autoFocus
                                placeholder={searchPlaceholder}
                                className={cn(
                                    'w-full min-w-0 rounded-xl border border-warm-border bg-warm-surface px-9 py-2 text-sm font-medium text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] transition-colors placeholder:text-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface dark:text-slate-50 dark:placeholder:text-stone-500',
                                    searchInputClassName,
                                )}
                            />
                        </div>
                    </div>
                    <ComboboxList aria-label={listboxLabel ?? ariaLabel}>
                        {filteredOptions.length === 0 ? (
                            <div className="px-3 py-5 text-center text-xs font-medium text-stone-500 dark:text-stone-400">
                                {emptyMessage}
                            </div>
                        ) : (
                            filteredOptions.map((option) => {
                                const description = searchableSelectText(option.description);
                                const optionLabel = searchableSelectText(option.label) || String(option.value);
                                const optionAriaLabel = [optionLabel, description].filter(Boolean).join(' ');
                                const selected = String(option.value) === String(value);
                                return (
                                    <SelectItem
                                        key={String(option.value)}
                                        value={String(option.value)}
                                        render={<ComboboxItem />}
                                        aria-label={optionAriaLabel}
                                        disabled={option.disabled}
                                        className={cn(
                                            'flex min-h-[42px] w-full cursor-default items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors outline-none',
                                            selected
                                                ? 'bg-warm-muted/80 text-slate-950 dark:bg-slate-800 dark:text-slate-50'
                                                : 'text-slate-900 hover:bg-warm-muted/75 data-[active-item]:bg-warm-muted/75 dark:text-slate-100 dark:hover:bg-slate-800/80 dark:data-[active-item]:bg-slate-800/80',
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
                                    </SelectItem>
                                );
                            })
                        )}
                    </ComboboxList>
                </SelectPopover>
            </SelectProvider>
        </ComboboxProvider>
    );
}
