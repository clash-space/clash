import { ComboboxItem, ComboboxList, ComboboxProvider } from '@ariakit/react';
import { agentHandle, agentInitials, type AgentRow } from './panel-types';

interface MentionAutocompleteProps {
  open: boolean;
  matches: AgentRow[];
  activeIndex: number;
  onHover: (idx: number) => void;
  onPick: (row: AgentRow) => void;
  listboxId: string;
  optionId: (idx: number) => string;
}

export function MentionAutocomplete({
  open,
  matches,
  activeIndex,
  onHover,
  onPick,
  listboxId,
  optionId,
}: MentionAutocompleteProps) {
  if (!open || matches.length === 0) return null;

  return (
    <ComboboxProvider value="" setValue={() => undefined}>
      <ComboboxList
        id={listboxId}
        aria-label="Agent matches"
        alwaysVisible
        className="absolute left-4 right-4 bottom-full mb-2 z-30 bg-warm-surface border border-warm-border rounded-matrix shadow-lg overflow-hidden"
      >
        <div className="px-3 py-1.5 bg-warm-muted">
          <div className="font-display text-[10px] font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider">
            Address agent
          </div>
        </div>
        {matches.map((c, idx) => {
          const handle = agentHandle(c.display_name);
          const offline = c.runtime_status !== 'online';
          const selected = idx === activeIndex;
          return (
            <ComboboxItem
              key={c.id}
              id={optionId(idx)}
              value={handle}
              setValueOnClick={false}
              selectValueOnClick={false}
              aria-selected={selected}
              onMouseDown={(e) => {
                // mousedown, not click: textarea blur fires before click
                // and would close the popover via the panel's onBlur.
                e.preventDefault();
                onPick(c);
              }}
              onMouseEnter={() => onHover(idx)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors outline-none ${
                selected ? 'bg-warm-hover' : 'hover:bg-warm-muted data-[active-item]:bg-warm-muted'
              }`}
            >
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full bg-warm-muted text-[10px] font-bold text-stone-700 dark:text-stone-200"
                aria-hidden="true"
              >
                {agentInitials(c.display_name)}
              </span>
              <span className="flex-1 text-left">
                <span className="font-medium text-stone-800 dark:text-stone-100">@{handle}</span>
                <span className="text-stone-400 dark:text-stone-500 ml-1.5">{c.display_name}</span>
              </span>
              <span
                className={`w-1.5 h-1.5 rounded-full ${offline ? 'bg-status-down' : 'bg-status-ready'}`}
                aria-label={offline ? 'Offline' : 'Online'}
              />
            </ComboboxItem>
          );
        })}
      </ComboboxList>
    </ComboboxProvider>
  );
}
