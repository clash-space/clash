/**
 * The "+ Invite agent" button in the tab row, plus the dropdown listing
 * uninvited claimed agent. Empty / loading / all-invited states each
 * render their own bit of inline copy so the user knows whether to wait,
 * claim more agent in Settings, or just close the menu.
 * Placement, focus, outside click, and Escape behavior are owned by the
 * shared Radix-backed dropdown primitives.
 */

import { motion } from 'framer-motion';
import { Plus, Gear } from '@phosphor-icons/react';
import type { AgentRow } from './panel-types';
import { EmptyState } from './EmptyState';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';

interface InviteAgentMenuProps {
  open: boolean;
  onToggle: () => void;
  uninvitedClaimed: AgentRow[];
  totalClaimed: number;
  loading: boolean;
  onInvite: (row: AgentRow) => void;
  onOpenSettings: () => void;
}

export function InviteAgentMenu({
  open,
  onToggle,
  uninvitedClaimed,
  totalClaimed,
  loading,
  onInvite,
  onOpenSettings,
}: InviteAgentMenuProps) {
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen !== open) onToggle();
  };

  return (
    <div className="shrink-0">
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="h-11 w-11 rounded-matrix bg-warm-muted hover:bg-warm-hover hover:text-brand text-stone-500 dark:text-stone-400 flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-1 focus-visible:ring-offset-warm-surface"
            title="Invite agent"
            aria-label="Invite agent member"
          >
            <Plus className="w-4 h-4" weight="bold" aria-hidden="true" />
          </motion.button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="left"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          aria-label="Claimed agent"
          className="w-72 overflow-hidden rounded-matrix p-0"
        >
          <div className="px-3 py-2 border-b border-warm-border bg-warm-muted">
            <div className="font-display text-[10px] font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider">
              Invite agent
            </div>
          </div>
          {loading ? (
            <EmptyState tone="muted" size="sm">
              Loading...
            </EmptyState>
          ) : totalClaimed === 0 ? (
            <>
              <EmptyState size="sm">No agent claimed yet.</EmptyState>
              <div className="px-2 pb-2">
                <DropdownMenuItem
                  onSelect={onOpenSettings}
                  className="justify-center text-brand hover:text-brand/80"
                >
                  Open Settings <Gear className="w-3 h-3" aria-hidden="true" />
                </DropdownMenuItem>
              </div>
            </>
          ) : uninvitedClaimed.length === 0 ? (
            <EmptyState tone="muted" size="sm">
              All claimed agent already invited.
            </EmptyState>
          ) : (
            <div className="py-1">
              {uninvitedClaimed.map((c) => {
                const offline = c.runtime_status !== 'online';
                return (
                  <DropdownMenuItem
                    key={c.id}
                    onSelect={() => onInvite(c)}
                    disabled={offline}
                    title={offline ? 'Runtime offline' : ''}
                    aria-label={`Invite ${c.display_name}${offline ? ' (offline)' : ''}`}
                    className="min-h-[44px] flex-col items-start gap-0 rounded-none px-3 py-2.5 text-xs"
                  >
                    <div className="font-medium text-stone-800 dark:text-stone-100 flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className={`inline-block w-1.5 h-1.5 rounded-full ${
                          offline ? 'bg-status-down' : 'bg-status-ready'
                        }`}
                      />
                      {c.display_name}
                    </div>
                    <div className="text-stone-500 dark:text-stone-400 mt-0.5">
                      {c.template_id} · {c.runtime_label || c.runtime_id.slice(0, 8)}
                      {offline && ' · offline'}
                    </div>
                  </DropdownMenuItem>
                );
              })}
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
