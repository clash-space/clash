/**
 * Floating popover that surfaces invited-crew matches for the current
 * `@<query>` token. Pure presentation — state lives in
 * useMentionAutocomplete; this component only consumes it.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { crewHandle, crewInitials, type CrewRow } from './panel-types';

interface MentionAutocompleteProps {
  open: boolean;
  matches: CrewRow[];
  activeIndex: number;
  onHover: (idx: number) => void;
  onPick: (row: CrewRow) => void;
}

export function MentionAutocomplete({ open, matches, activeIndex, onHover, onPick }: MentionAutocompleteProps) {
  return (
    <AnimatePresence>
      {open && matches.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          className="absolute left-4 right-4 bottom-full mb-2 z-30 bg-warm-surface/95 backdrop-blur-xl rounded-matrix shadow-xl overflow-hidden"
        >
          <div className="px-3 py-1.5 bg-warm-muted/60">
            <div className="font-display text-[10px] font-semibold text-stone-500 uppercase tracking-wider">
              Address crew
            </div>
          </div>
          {matches.map((c, idx) => {
            const handle = crewHandle(c.display_name);
            const offline = c.runtime_status !== 'online';
            return (
              <button
                key={c.id}
                type="button"
                onMouseDown={(e) => {
                  // mousedown, not click: textarea blur fires before click
                  // and would close the popover via the panel's onBlur.
                  e.preventDefault();
                  onPick(c);
                }}
                onMouseEnter={() => onHover(idx)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                  idx === activeIndex ? 'bg-warm-muted' : 'hover:bg-warm-muted/60'
                }`}
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-warm-muted text-[10px] font-bold text-stone-700">
                  {crewInitials(c.display_name)}
                </span>
                <span className="flex-1 text-left">
                  <span className="font-medium text-stone-800">@{handle}</span>
                  <span className="text-stone-400 ml-1.5">{c.display_name}</span>
                </span>
                <span className={`w-1.5 h-1.5 rounded-full ${offline ? 'bg-stone-300' : 'bg-emerald-500'}`} />
              </button>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
