/**
 * Pill-shaped chip used for the tab row in GroupChatPanel.
 *
 * Active = filled brand→red gradient; inactive = frosted warm-surface
 * with a subtle border. Crew pills carry an avatar (initials) with
 * status pip + unread / pending-prompts indicators. Room pill is plain
 * `#` text — no avatar, no status.
 */

import { motion } from 'framer-motion';
import { statusDotClass, statusDotLabel } from './statusDot';

export interface TabPillProps {
  label: string;
  active: boolean;
  onClick: () => void;
  /** Close handler; passing it adds the (× hover-revealed) close button. */
  onClose?: () => void;
  unread?: boolean;
  pendingCount?: number;
  /** Raw crew status string — mapped to dot color + a11y label internally. */
  status?: string;
  /** Avatar initials. Required for `kind === 'crew'`. */
  initials?: string;
  kind?: 'room' | 'crew';
}

export function TabPill({
  label,
  active,
  onClick,
  onClose,
  unread,
  pendingCount,
  status,
  initials,
  kind = 'crew',
}: TabPillProps) {
  return (
    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="shrink-0">
      <button
        onClick={onClick}
        className={`group relative flex items-center gap-2 h-8 pl-1.5 pr-3 rounded-matrix text-xs font-medium transition-all ${
          active
            ? 'bg-gradient-to-br from-brand to-red-500 text-white shadow-md'
            : 'bg-warm-muted/70 backdrop-blur-sm text-stone-700 hover:bg-warm-muted hover:text-stone-900'
        }`}
        aria-pressed={active}
      >
        {kind === 'room' ? (
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
              active ? 'bg-white/25 text-white' : 'bg-warm-surface/80 text-stone-500'
            }`}
          >
            #
          </span>
        ) : (
          <span className="relative">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${
                active ? 'bg-white/25 text-white' : 'bg-warm-surface/80 text-stone-700'
              }`}
            >
              {initials}
            </span>
            {status !== undefined && (
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${statusDotClass(status)}`}
                title={statusDotLabel(status)}
                aria-label={statusDotLabel(status)}
              />
            )}
          </span>
        )}
        <span>{label}</span>
        {unread && !active && <span className="w-1.5 h-1.5 rounded-full bg-brand" aria-label="Unread" />}
        {pendingCount && pendingCount > 0 ? (
          <span
            className={`min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center ${
              active ? 'bg-white/30 text-white' : 'bg-amber-500 text-white'
            }`}
            title={`${pendingCount} prompt${pendingCount === 1 ? '' : 's'} queued — will send after the current turn`}
          >
            {pendingCount}
          </span>
        ) : null}
        {onClose && (
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className={`ml-0.5 text-[14px] leading-none opacity-0 group-hover:opacity-100 transition-opacity ${
              active ? 'text-white/80 hover:text-white' : 'text-stone-400 hover:text-brand'
            }`}
            title="Remove from room"
          >
            ×
          </span>
        )}
      </button>
    </motion.div>
  );
}
