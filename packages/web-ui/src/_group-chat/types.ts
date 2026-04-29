/**
 * Vendored from openma's group-chat primitives (independent
 * implementation; sync with upstream when openma stabilizes its
 * surface). Underscore prefix marks the module as vendored — same
 * convention as `_acp-runtime/` in clash-bridge.
 *
 * Core idea (from user's design):
 *   - All events relay as messages on a per-crew log.
 *   - User prompts route via @-mentions; un-mentioned messages target
 *     the currently focused crew.
 *   - Routing model is *append-on-next-turn*, NOT cancel-and-steer:
 *     a prompt arriving mid-turn is queued and sent right after the
 *     current turn's session.complete (no interrupt).
 *   - "@-someone not in the group" auto-pulls them in (spawn + add).
 *
 * No React dependency — these classes own state and emit changes;
 * the hook layer (useGroupChat) wraps them with useSyncExternalStore.
 */

import type { ByoMessage, AvailableCommand } from '../lib/acpEvents';

export type CrewStatus =
  | 'connecting'
  | 'connected'    // idle, ready for next prompt
  | 'sending'     // outbound prompt in flight to bridge
  | 'streaming'   // receiving session.event chunks
  | 'disconnected'
  | 'error';

export interface CrewView {
  /** Crew member id (e.g. "director"). */
  crewId: string;
  /** Server-side runtime_session row id, "" until POST /sessions returns. */
  sessionId: string;
  status: CrewStatus;
  errorMessage: string | null;
  messages: ByoMessage[];
  availableCommands: AvailableCommand[];
  /** Number of queued prompts waiting for the current turn to finish. */
  pendingCount: number;
  /** True iff this crew has new traffic the user hasn't focused on. */
  unread: boolean;
  lastActiveAt: number;
}

/** A prompt that came in for a crew member. */
export interface QueuedPrompt {
  text: string;
  /** When the user typed it (for ordering / display). */
  enqueuedAt: number;
}

/** Listener for group-chat state changes. Called on every mutation. */
export type Subscriber = () => void;
