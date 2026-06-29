/**
 * Agent status → status-dot Tailwind class.
 *
 * Four meaningful states, mapped to color + animation:
 *
 *   ● green        "live"          — actively streaming events right now
 *                                     (status: streaming, sending)
 *   ● amber        "linked"        — WS is connected, idle / waiting / setting up
 *                                     (status: connected, connecting)
 *   ◐ amber-pulse  "reconnecting"  — daemon dropped; auto-recovery in progress
 *                                     (status: reconnecting). Pulsing animation
 *                                     signals "we're working on it, don't touch"
 *                                     so users don't think it's dead and
 *                                     uninvite-then-reinvite (losing history).
 *   ○ empty        "offline"       — truly stuck; manual retry needed
 *                                     (status: disconnected, error, unknown)
 *
 * "Empty" renders as a 1px hollow ring so the dot's hit area still
 * lands in the tab pill grid without leaving an empty void — purely
 * a layout courtesy.
 */

export type StatusDotKind = 'live' | 'linked' | 'reconnecting' | 'offline';

export function statusDotKind(status: string | undefined): StatusDotKind {
  if (status === 'streaming' || status === 'sending') return 'live';
  if (status === 'connected' || status === 'connecting') return 'linked';
  if (status === 'reconnecting') return 'reconnecting';
  return 'offline';
}

export function statusDotClass(status: string | undefined): string {
  switch (statusDotKind(status)) {
    case 'live':         return 'bg-status-ready';
    case 'linked':       return 'bg-status-busy';
    case 'reconnecting': return 'bg-status-busy animate-pulse';
    case 'offline':      return 'border border-status-down/40 bg-transparent';
  }
}

/** Human-readable label for a11y / tooltip. */
export function statusDotLabel(status: string | undefined): string {
  switch (statusDotKind(status)) {
    case 'live':         return 'Live — streaming';
    case 'linked':       return 'Linked — idle';
    case 'reconnecting': return 'Reconnecting — daemon dropped, waiting for it to come back';
    case 'offline':      return 'Offline';
  }
}
