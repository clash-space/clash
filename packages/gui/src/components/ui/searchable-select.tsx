import {
  Children,
  isValidElement,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CaretDown } from "@phosphor-icons/react";

import { cn } from "../../lib/cn";
import { Button } from "./button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { useControlContext, type ControlContextName } from "./control-context";
import type { SelectOption, SelectValue } from "./select";

export function searchableSelectText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(searchableSelectText).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return Children.toArray(node.props.children)
      .map(searchableSelectText)
      .join(" ");
  }
  return "";
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
  density?: "default" | "compact";
  listClassName?: string;
  searchInputClassName?: string;
  triggerClassName?: string;
  triggerLabel?: ReactNode;
  matchTriggerWidth?: boolean;
  context?: ControlContextName;
}

function optionSearchText<Value extends SelectValue>(
  option: SelectOption<Value>,
): string {
  return [
    searchableSelectText(option.label),
    searchableSelectText(option.description),
    String(option.value),
    option.searchText,
  ]
    .filter(Boolean)
    .join(" ");
}

export function SearchableSelect<Value extends SelectValue = string>({
  ariaLabel,
  contentClassName,
  contentWidth = "min(360px, calc(100vw - 24px))",
  density = "default",
  emptyMessage,
  listboxLabel,
  listClassName,
  matchTriggerWidth = false,
  onValueChange,
  options,
  placeholder = "Select option",
  searchAriaLabel,
  searchInputClassName,
  searchPlaceholder = "Search...",
  triggerClassName,
  triggerLabel,
  value,
  context,
}: SearchableSelectProps<Value>) {
  const inheritedContext = useControlContext();
  const resolvedContext = context ?? inheritedContext;
  const [open, setOpen] = useState(false);
  const selectedOption = useMemo(
    () => options.find((option) => String(option.value) === String(value)),
    [options, value],
  );
  const selectedLabel =
    triggerLabel ??
    (selectedOption
      ? searchableSelectText(selectedOption.label) ||
        String(selectedOption.value)
      : "");

  const selectOption = useCallback(
    (option: SelectOption<Value>) => {
      if (option.disabled) return;
      onValueChange(option.value, option);
      setOpen(false);
    },
    [onValueChange],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={null}
          size={null}
          shape={null}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          disabled={options.length === 0}
          data-slot="searchable-select-trigger"
          data-density={density}
          data-size="md"
          data-context={resolvedContext}
          className={cn(
            "app-select-trigger clash-select-trigger flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-3 text-sm font-medium text-foreground transition-colors outline-none",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
            "dark:bg-input/30 dark:hover:bg-input/50",
            triggerClassName,
          )}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left",
              !selectedOption && "text-muted-foreground",
            )}
          >
            {selectedOption ? selectedLabel : placeholder}
          </span>
          <CaretDown
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={listboxLabel ?? ariaLabel}
        data-context={resolvedContext}
        data-density={density}
        align="start"
        className={cn(
          "app-select-content z-[90] overflow-hidden rounded-lg p-0",
          contentClassName,
        )}
        style={{
          width: matchTriggerWidth
            ? "var(--radix-popover-trigger-width)"
            : contentWidth,
        }}
      >
        <Command
          label={searchAriaLabel ?? `Search ${ariaLabel.toLowerCase()}`}
          className="border-0 shadow-none"
        >
          <CommandInput
            aria-label={searchAriaLabel ?? `Search ${ariaLabel.toLowerCase()}`}
            autoFocus
            placeholder={searchPlaceholder}
            className={searchInputClassName}
          />
          <CommandList
            aria-label={listboxLabel ?? ariaLabel}
            className={listClassName}
          >
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {options.map((option) => {
              const description = searchableSelectText(option.description);
              const optionLabel =
                searchableSelectText(option.label) || String(option.value);
              const optionAriaLabel = [optionLabel, description]
                .filter(Boolean)
                .join(" ");
              const selected = String(option.value) === String(value);
              return (
                <CommandItem
                  key={String(option.value)}
                  value={String(option.value)}
                  keywords={[optionSearchText(option)]}
                  aria-label={optionAriaLabel}
                  data-checked={selected}
                  data-density={density}
                  disabled={option.disabled}
                  onSelect={() => selectOption(option)}
                >
                  {option.icon ? (
                    <span
                      data-slot="searchable-select-option-icon"
                      className="flex size-5 shrink-0 items-center justify-center text-muted-foreground"
                      aria-hidden="true"
                    >
                      {option.icon}
                    </span>
                  ) : null}
                  <span
                    data-slot="searchable-select-option-content"
                    data-layout={density === "compact" ? "inline" : "stacked"}
                    className={cn(
                      "min-w-0 flex-1",
                      density === "compact" && "flex items-center gap-2",
                    )}
                  >
                    <span
                      data-slot="searchable-select-option-label"
                      className={cn(
                        "truncate font-medium",
                        density === "compact"
                          ? "min-w-0 flex-1 leading-4"
                          : "block leading-5",
                      )}
                    >
                      {option.label}
                    </span>
                    {option.description ? (
                      <span
                        data-slot="searchable-select-option-description"
                        className={cn(
                          "truncate text-xs font-normal text-muted-foreground",
                          density === "compact"
                            ? "ml-auto max-w-[45%] shrink-0 text-right leading-4"
                            : "block leading-4",
                        )}
                      >
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
