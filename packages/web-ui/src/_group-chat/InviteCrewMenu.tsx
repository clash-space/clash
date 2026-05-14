/**
 * The "+ Invite crew" button in the tab row, plus the dropdown listing
 * uninvited claimed crew. Empty / loading / all-invited states each
 * render their own bit of inline copy so the user knows whether to wait,
 * claim more crew in Settings, or just close the menu.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Gear } from '@phosphor-icons/react';
import type { CrewRow } from './panel-types';

interface InviteCrewMenuProps {
  open: boolean;
  onToggle: () => void;
  uninvitedClaimed: CrewRow[];
  totalClaimed: number;
  loading: boolean;
  onInvite: (row: CrewRow) => void;
}

export function InviteCrewMenu({
  open,
  onToggle,
  uninvitedClaimed,
  totalClaimed,
  loading,
  onInvite,
}: InviteCrewMenuProps) {
  return (
    <div className="relative shrink-0">
      <motion.button
        onClick={onToggle}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="h-8 w-8 rounded-matrix bg-warm-muted/70 backdrop-blur-sm hover:bg-warm-muted hover:text-brand text-stone-500 flex items-center justify-center transition-colors"
        title="Invite crew"
        aria-expanded={open}
      >
        <Plus className="w-3.5 h-3.5" weight="bold" />
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            className="absolute right-0 top-10 z-30 w-72 bg-warm-surface/95 backdrop-blur-xl rounded-matrix shadow-xl border border-warm-border overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-warm-border bg-warm-muted/60">
              <div className="font-display text-[10px] font-semibold text-stone-500 uppercase tracking-wider">
                Invite crew
              </div>
            </div>
            {loading ? (
              <div className="px-3 py-3 text-xs text-stone-400">Loading…</div>
            ) : totalClaimed === 0 ? (
              <div className="px-3 py-3 text-xs text-stone-500 leading-relaxed">
                No crew claimed yet.{' '}
                <a
                  href="/settings"
                  className="text-brand hover:text-brand/80 underline inline-flex items-center gap-0.5"
                >
                  Open Settings <Gear className="w-3 h-3" />
                </a>
              </div>
            ) : uninvitedClaimed.length === 0 ? (
              <div className="px-3 py-3 text-xs text-stone-400">All claimed crew already invited.</div>
            ) : (
              <div className="py-1">
                {uninvitedClaimed.map((c) => {
                  const offline = c.runtime_status !== 'online';
                  return (
                    <button
                      key={c.id}
                      onClick={() => onInvite(c)}
                      disabled={offline}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-warm-muted disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
                      title={offline ? 'Runtime offline' : ''}
                    >
                      <div className="font-medium text-stone-800 flex items-center gap-1.5">
                        <span
                          className={`inline-block w-1.5 h-1.5 rounded-full ${offline ? 'bg-stone-300' : 'bg-emerald-500'}`}
                        />
                        {c.display_name}
                      </div>
                      <div className="text-stone-500 mt-0.5">
                        {c.template_id} · {c.runtime_label || c.runtime_id.slice(0, 8)}
                        {offline && ' · offline'}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
