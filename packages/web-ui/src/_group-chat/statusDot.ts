/**
 * Crew status → status-dot Tailwind class.
 *
 * Mapping is intentionally narrow: amber means "doing something now",
 * emerald means "ready", stone means "not usable right now". Anything
 * unknown falls to the same neutral grey to avoid confusing greens.
 */

export type StatusDotKind = 'idle' | 'busy' | 'ready' | 'down';

export function statusDotKind(status: string | undefined): StatusDotKind {
  if (status === 'streaming' || status === 'sending' || status === 'connecting') return 'busy';
  if (status === 'connected') return 'ready';
  if (status === 'error' || status === 'disconnected') return 'down';
  return 'idle';
}

export function statusDotClass(status: string | undefined): string {
  switch (statusDotKind(status)) {
    case 'busy':  return 'bg-amber-500';
    case 'ready': return 'bg-emerald-500';
    case 'down':  return 'bg-stone-400';
    case 'idle':  return 'bg-stone-300';
  }
}

/** Human-readable label for a11y / tooltip. */
export function statusDotLabel(status: string | undefined): string {
  switch (statusDotKind(status)) {
    case 'busy':  return 'Working';
    case 'ready': return 'Ready';
    case 'down':  return 'Offline / errored';
    case 'idle':  return 'Idle';
  }
}
