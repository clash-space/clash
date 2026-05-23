/**
 * Pill-shaped chip used for the tab row in GroupChatPanel.
 *
 * a11y: implements WAI-ARIA tab semantics so screen readers announce the
 * tab list and which tab is selected. The parent (`GroupChatPanel`) owns
 * arrow-key navigation across the tablist; this component is just a
 * single tab. Each tab carries `tabIndex={active ? 0 : -1}` (roving
 * tabindex) so Tab/Shift-Tab moves to the *next* widget, not between
 * tabs.
 *
 * Active state is a solid brand fill (no gradient) — keeps a single
 * "this is the focus" cue across the panel instead of having every chip
 * sport a gradient.
 */

import { motion } from 'framer-motion';
import { forwardRef } from 'react';
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
  /** id of the panel this tab controls — pairs with the panel's
   *  `aria-labelledby`. The parent generates and threads the same id. */
  controlsId?: string;
  /** id of this tab — used by the controlled panel's `aria-labelledby`. */
  tabId?: string;
  /** Forwarded to the inner <button>. Parent uses focus() for arrow-key nav. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  /** Compact (avatar-only) variant for the vertical left sidebar.
   *  Hides the text label and close button; full label moves to the
   *  tooltip. Status dot + unread/pending badges still render. */
  compact?: boolean;
}

export const TabPill = forwardRef<HTMLButtonElement, TabPillProps>(function TabPill(
  {
    label,
    active,
    onClick,
    onClose,
    unread,
    pendingCount,
    status,
    initials,
    kind = 'crew',
    controlsId,
    tabId,
    onKeyDown,
    compact = false,
  },
  ref,
) {
  // Compact (sidebar) and horizontal (top bar) variants share a lot —
  // tab semantics, status dot, unread/pending badges — but diverge in
  // shape: compact is a 40px square avatar tile with no text label;
  // horizontal is the original pill with avatar + label inline.
  const avatarSize = compact ? 'h-9 w-9 text-xs' : 'h-5 w-5 text-[9px]';
  const wrapperShape = compact
    ? 'min-h-11 min-w-11 p-1 rounded-matrix justify-center'
    : 'min-h-[44px] py-1 pl-1.5 pr-3 rounded-matrix gap-2';
  return (
    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="shrink-0">
      <button
        ref={ref}
        id={tabId}
        role="tab"
        aria-selected={active}
        aria-controls={controlsId}
        tabIndex={active ? 0 : -1}
        onClick={onClick}
        onKeyDown={onKeyDown}
        title={compact ? label : undefined}
        className={`group relative flex items-center text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-1 focus-visible:ring-offset-warm-surface ${wrapperShape} ${
          active
            ? 'bg-brand text-brand-foreground shadow-sm'
            : 'bg-warm-muted text-stone-700 dark:text-stone-200 hover:bg-warm-hover hover:text-stone-900 dark:hover:text-white'
        }`}
      >
        {kind === 'room' ? (
          <span
            aria-hidden="true"
            className={`flex items-center justify-center rounded-full font-bold ${avatarSize} ${
              active ? 'bg-white/25 text-white' : 'bg-warm-surface text-stone-500 dark:text-stone-400'
            }`}
          >
            #
          </span>
        ) : (
          <span className="relative">
            <span
              aria-hidden="true"
              className={`flex items-center justify-center rounded-full font-bold ${avatarSize} ${
                active ? 'bg-white/25 text-white' : 'bg-warm-surface text-stone-700 dark:text-stone-200'
              }`}
            >
              {initials}
            </span>
            {status !== undefined && (
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-warm-surface ${statusDotClass(status)}`}
                title={statusDotLabel(status)}
                aria-label={statusDotLabel(status)}
                role="status"
              />
            )}
          </span>
        )}
        {!compact && <span>{label}</span>}
        {/* Unread + pending badges. In compact mode they overlay the
            avatar's top-right corner; in horizontal mode they sit
            inline after the label. */}
        {unread && !active && (
          <span
            className={`rounded-full bg-brand ${
              compact
                ? 'absolute top-0 right-0 w-2 h-2 ring-2 ring-warm-surface'
                : 'w-1.5 h-1.5'
            }`}
            aria-label="Unread messages"
          />
        )}
        {pendingCount && pendingCount > 0 ? (
          <span
            className={`min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center ${
              active ? 'bg-white/30 text-white' : 'bg-status-busy text-white'
            } ${compact ? 'absolute -top-1 -right-1 ring-2 ring-warm-surface' : ''}`}
            title={`${pendingCount} prompt${pendingCount === 1 ? '' : 's'} queued — will send after the current turn`}
            aria-label={`${pendingCount} pending prompt${pendingCount === 1 ? '' : 's'}`}
          >
            {pendingCount}
          </span>
        ) : null}
        {/* Close button hidden in compact mode (use right-click /
            keyboard remove later if needed; sidebar real estate is too
            tight for a hover-revealed ×). */}
        {onClose && !compact && (
          <span
            role="button"
            aria-label={`Remove ${label} from room`}
            tabIndex={active ? 0 : -1}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }
            }}
            className={`ml-0.5 text-[14px] leading-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity ${
              active ? 'text-white/80 hover:text-white' : 'text-stone-400 hover:text-brand'
            }`}
          >
            ×
          </span>
        )}
      </button>
    </motion.div>
  );
});
