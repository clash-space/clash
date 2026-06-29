/**
 * Single layout for empty states in the chat panel (Room blank, no
 * messages for a agent, all agent invited, loading list, …). Keeps the
 * spacing/typography consistent so the panel doesn't read as three
 * different products stitched together.
 *
 * `tone` only changes the body color; the structure stays the same. Use:
 *   - `default` for neutral hints ("No messages yet")
 *   - `muted`   for "still loading" / "all done" — less prominent
 */

import type { ReactNode } from 'react';

interface EmptyStateProps {
  children: ReactNode;
  tone?: 'default' | 'muted';
  /** Vertical padding scale — `lg` for the main view, `sm` for popovers. */
  size?: 'sm' | 'lg';
}

export function EmptyState({ children, tone = 'default', size = 'lg' }: EmptyStateProps) {
  const padding = size === 'lg' ? 'py-12 px-4' : 'py-3 px-3';
  const color = tone === 'muted' ? 'text-stone-400 dark:text-stone-500' : 'text-stone-500 dark:text-stone-400';
  return (
    <div className={`text-center text-sm leading-relaxed ${padding} ${color}`}>
      {children}
    </div>
  );
}
