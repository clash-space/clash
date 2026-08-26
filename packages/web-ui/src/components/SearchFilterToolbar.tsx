import {
  CaretRight,
  Check,
  MagnifyingGlass,
  SlidersHorizontal,
  X,
} from "@phosphor-icons/react";

import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemIndicator,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input } from "./ui/input";

export type SearchFilterToolbarContext = "page" | "dialog";

export interface SearchFilterOption {
  value: string;
  label: string;
}

export interface SearchFilterGroup {
  id: string;
  label: string;
  options: ReadonlyArray<SearchFilterOption>;
  selectedValues: ReadonlyArray<string>;
  onSelectedValuesChange: (values: string[]) => void;
}

function activeOptions(group: SearchFilterGroup) {
  const selected = new Set(group.selectedValues);
  return group.options.filter((option) => selected.has(option.value));
}

function toggleGroupOption(
  group: SearchFilterGroup,
  value: string,
  checked: boolean,
) {
  const next = new Set(group.selectedValues);
  if (checked) next.add(value);
  else next.delete(value);
  group.onSelectedValuesChange(
    group.options
      .map((option) => option.value)
      .filter((optionValue) => next.has(optionValue)),
  );
}

function SearchFilterMenu({
  groups,
}: {
  groups: ReadonlyArray<SearchFilterGroup>;
}) {
  const activeGroups = groups.filter(
    (group) => activeOptions(group).length > 0,
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={null}
          size={null}
          shape={null}
          aria-label="Filter"
          className="h-7 shrink-0 rounded-md border-0 bg-transparent px-2 text-xs font-medium text-content-secondary shadow-none hover:bg-accent hover:text-content-primary"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          Filter
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-label="Search filters"
        className="min-w-48"
      >
        {groups.map((group) => {
          const selectedCount = activeOptions(group).length;
          return (
            <DropdownMenuSub key={group.id}>
              <DropdownMenuSubTrigger>
                <span className="min-w-0 flex-1 truncate">{group.label}</span>
                {selectedCount > 0 ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {selectedCount}
                  </span>
                ) : null}
                <CaretRight
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent aria-label={group.label}>
                {group.options.map((option) => {
                  const checked = group.selectedValues.includes(option.value);
                  return (
                    <DropdownMenuCheckboxItem
                      key={option.value}
                      checked={checked}
                      onCheckedChange={(nextChecked) =>
                        toggleGroupOption(
                          group,
                          option.value,
                          nextChecked === true,
                        )
                      }
                      onSelect={(event) => event.preventDefault()}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {option.label}
                      </span>
                      <DropdownMenuItemIndicator>
                        <Check
                          className="h-3.5 w-3.5"
                          weight="bold"
                          aria-hidden="true"
                        />
                      </DropdownMenuItemIndicator>
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}
        {activeGroups.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                for (const group of activeGroups) {
                  group.onSelectedValuesChange([]);
                }
              }}
            >
              Clear filters
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SearchField({
  query,
  onQueryChange,
  searchLabel,
  autoFocus = false,
  className = "",
  filterGroups = [],
}: {
  query: string;
  onQueryChange: (query: string) => void;
  searchLabel: string;
  autoFocus?: boolean;
  className?: string;
  filterGroups?: ReadonlyArray<SearchFilterGroup>;
}) {
  const availableFilterGroups = filterGroups.filter(
    (group) => group.options.length > 0,
  );
  const activeSelections = availableFilterGroups.flatMap((group) =>
    activeOptions(group).map((option) => ({ group, option })),
  );

  return (
    <div
      data-slot="search-field"
      data-leading-icon="true"
      role="search"
      className={`flex min-h-9 min-w-0 items-center gap-1.5 rounded-lg border border-input bg-background px-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 ${className}`}
    >
      <MagnifyingGlass
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-muted-foreground"
        weight="regular"
      />
      {activeSelections.length > 0 ? (
        <div
          data-slot="search-filter-chips"
          className="flex min-w-0 shrink items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {activeSelections.map(({ group, option }) => {
            return (
              <span
                key={`${group.id}:${option.value}`}
                data-slot="search-filter-chip"
                className="inline-flex h-6 max-w-64 shrink-0 items-center gap-1 rounded-md bg-muted pl-2 text-xs font-medium text-content-primary"
              >
                <span className="truncate">
                  {group.label} · {option.label}
                </span>
                <Button
                  variant={null}
                  size={null}
                  shape={null}
                  aria-label={`Remove ${group.label} filter: ${option.label}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => toggleGroupOption(group, option.value, false)}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-content-muted outline-none hover:bg-accent hover:text-content-primary focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3 w-3" weight="bold" aria-hidden="true" />
                </Button>
              </span>
            );
          })}
        </div>
      ) : null}
      <Input
        autoFocus={autoFocus}
        type="search"
        aria-label={searchLabel}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Backspace" &&
            query.length === 0 &&
            !event.nativeEvent.isComposing &&
            activeSelections.length > 0
          ) {
            event.preventDefault();
            const lastSelection = activeSelections.at(-1);
            if (lastSelection) {
              toggleGroupOption(
                lastSelection.group,
                lastSelection.option.value,
                false,
              );
            }
          }
        }}
        placeholder={searchLabel}
        controlSize="sm"
        className="h-7 min-w-32 flex-1 border-0 bg-transparent !px-0 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
      />
      {availableFilterGroups.length > 0 ? (
        <SearchFilterMenu groups={availableFilterGroups} />
      ) : null}
    </div>
  );
}

export function SearchFilterToolbar({
  query,
  onQueryChange,
  searchLabel,
  context = "page",
  spacing = "default",
  filterGroups,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  searchLabel: string;
  context?: SearchFilterToolbarContext;
  spacing?: "default" | "none";
  filterGroups?: ReadonlyArray<SearchFilterGroup>;
}) {
  return (
    <div
      data-slot="search-filter-toolbar"
      data-context={context}
      className={`flex w-full flex-wrap items-start gap-3 ${
        spacing === "default" ? "pb-4" : ""
      }`}
    >
      <SearchField
        query={query}
        onQueryChange={onQueryChange}
        searchLabel={searchLabel}
        autoFocus={context === "dialog"}
        filterGroups={filterGroups}
        className={
          context === "dialog"
            ? "min-w-64 flex-1 basis-72"
            : "min-w-[min(100%,18rem)] flex-[1_1_20rem]"
        }
      />
    </div>
  );
}
