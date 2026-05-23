/**
 * The "+ Invite crew" button in the tab row, plus the dropdown listing
 * uninvited claimed crew. Empty / loading / all-invited states each
 * render their own bit of inline copy so the user knows whether to wait,
 * claim more crew in Settings, or just close the menu.
 *
 * The popup is rendered through a React portal to document.body. This
 * sidesteps every z-index / overflow / stacking-context issue that
 * comes from being inside the chat panel's flex layout (sibling
 * panel card with overflow-hidden was clipping it; trying to
 * anchor with right-0/left-full kept hitting the viewport edge or
 * the panel's own border). At document.body level there's nothing
 * above us — the popup just floats.
 *
 * The button's bounding rect drives the popup position so it always
 * lines up just below the + tile regardless of where the rail moves
 * (resize, scroll, viewport change). Recomputed on open and on
 * window resize while open.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Gear } from '@phosphor-icons/react';
import type { CrewRow } from './panel-types';
import { EmptyState } from './EmptyState';

interface InviteCrewMenuProps {
  open: boolean;
  onToggle: () => void;
  uninvitedClaimed: CrewRow[];
  totalClaimed: number;
  loading: boolean;
  onInvite: (row: CrewRow) => void;
}

interface PopupRect {
  /** screen-y of the popup's top */
  top: number;
  /** screen-x of the popup's left edge */
  left: number;
}

const POPUP_WIDTH = 288; // matches w-72
const POPUP_OFFSET_X = 8; // gap between the + button and the popup
const POPUP_OFFSET_Y = 0; // top-aligned with the button

export function InviteCrewMenu({
  open,
  onToggle,
  uninvitedClaimed,
  totalClaimed,
  loading,
  onInvite,
}: InviteCrewMenuProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [rect, setRect] = useState<PopupRect | null>(null);

  // Measure the button's screen-space rect so the portal can position
  // the popup right next to it. useLayoutEffect (not effect) so the
  // first paint is correct — no visible position-snap.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = buttonRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Default: open to the LEFT of the button (since the rail sits
      // on the right side of the screen, opening into the canvas
      // area is the natural fit). Falls back to the right side if
      // there isn't enough room on the left.
      const wantLeft = r.left - POPUP_OFFSET_X - POPUP_WIDTH;
      const fitsLeft = wantLeft >= 8;
      setRect({
        top: r.top + POPUP_OFFSET_Y,
        left: fitsLeft ? wantLeft : r.right + POPUP_OFFSET_X,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  // Click-outside dismiss. Captures the popup's own clicks via the
  // ref check; clicks on the trigger are handled by its own onClick
  // (which toggles open back to false naturally).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t)) return;
      // The popup itself stops propagation below to avoid this branch.
      onToggle();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, onToggle]);

  const popup =
    open && rect && typeof document !== 'undefined'
      ? createPortal(
          <AnimatePresence>
            <motion.div
              role="menu"
              aria-label="Claimed crew"
              initial={{ opacity: 0, y: -6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.96 }}
              transition={{ duration: 0.12 }}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                position: 'fixed',
                top: rect.top,
                left: rect.left,
                width: POPUP_WIDTH,
                zIndex: 200,
              }}
              className="bg-warm-surface rounded-matrix shadow-lg border border-warm-border overflow-hidden"
            >
              <div className="px-3 py-2 border-b border-warm-border bg-warm-muted">
                <div className="font-display text-[10px] font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider">
                  Invite crew
                </div>
              </div>
              {loading ? (
                <EmptyState tone="muted" size="sm">
                  Loading…
                </EmptyState>
              ) : totalClaimed === 0 ? (
                <EmptyState size="sm">
                  No crew claimed yet.{' '}
                  <a
                    href="/settings"
                    className="text-brand hover:text-brand/80 underline inline-flex items-center gap-0.5"
                  >
                    Open Settings <Gear className="w-3 h-3" aria-hidden="true" />
                  </a>
                </EmptyState>
              ) : uninvitedClaimed.length === 0 ? (
                <EmptyState tone="muted" size="sm">
                  All claimed crew already invited.
                </EmptyState>
              ) : (
                <div className="py-1">
                  {uninvitedClaimed.map((c) => {
                    const offline = c.runtime_status !== 'online';
                    return (
                      <button
                        key={c.id}
                        role="menuitem"
                        onClick={() => onInvite(c)}
                        disabled={offline}
                        className="w-full text-left px-3 py-2.5 min-h-[44px] text-xs hover:bg-warm-muted disabled:opacity-50 disabled:hover:bg-transparent transition-colors focus:outline-none focus-visible:bg-warm-hover"
                        title={offline ? 'Runtime offline' : ''}
                        aria-label={`Invite ${c.display_name}${offline ? ' (offline)' : ''}`}
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
                      </button>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </AnimatePresence>,
          document.body,
        )
      : null;

  return (
    <div className="shrink-0">
      <motion.button
        ref={buttonRef}
        onClick={onToggle}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="h-11 w-11 rounded-matrix bg-warm-muted hover:bg-warm-hover hover:text-brand text-stone-500 dark:text-stone-400 flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-1 focus-visible:ring-offset-warm-surface"
        title="Invite crew"
        aria-label="Invite crew member"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Plus className="w-4 h-4" weight="bold" aria-hidden="true" />
      </motion.button>
      {popup}
    </div>
  );
}
