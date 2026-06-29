/**
 * Floating popover that surfaces invited-agent matches for the current
 * `@<query>` token. Pure presentation — state lives in
 * useMentionAutocomplete; this component only consumes it.
 *
 * a11y: the container is a `role="listbox"` and each row a `role="option"`
 * with `aria-selected`. The composer textarea points to this listbox via
 * `aria-controls={listboxId}` + `aria-activedescendant={optionId(active)}`,
 * which is the standard combobox-without-input pattern AT readers expect.
 */

import { motion, AnimatePresence } from 'framer-motion';
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
  return (
    <AnimatePresence>
      {open && matches.length > 0 && (
        <motion.ul
          id={listboxId}
          role="listbox"
          aria-label="Agent matches"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.12 }}
          className="absolute left-4 right-4 bottom-full mb-2 z-30 bg-warm-surface border border-warm-border rounded-matrix shadow-lg overflow-hidden"
        >
          <li className="px-3 py-1.5 bg-warm-muted">
            <div className="font-display text-[10px] font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider">
              Address agent
            </div>
          </li>
          {matches.map((c, idx) => {
            const handle = agentHandle(c.display_name);
            const offline = c.runtime_status !== 'online';
            const selected = idx === activeIndex;
            return (
              <li
                key={c.id}
                id={optionId(idx)}
                role="option"
                aria-selected={selected}
              >
                <button
                  type="button"
                  onMouseDown={(e) => {
                    // mousedown, not click: textarea blur fires before click
                    // and would close the popover via the panel's onBlur.
                    e.preventDefault();
                    onPick(c);
                  }}
                  onMouseEnter={() => onHover(idx)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                    selected ? 'bg-warm-hover' : 'hover:bg-warm-muted'
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
                </button>
              </li>
            );
          })}
        </motion.ul>
      )}
    </AnimatePresence>
  );
}
