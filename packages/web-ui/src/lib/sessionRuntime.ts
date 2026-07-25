export const HARNESS_UPDATED_EVENT = 'clash-harness-updated';
export const SESSION_RESTART_COMPLETE_VISIBLE_MS = 2_400;

export interface SessionRuntimeStatus {
  session_id: string;
  harness_id: string;
  harness_label: string;
  running_version?: string;
  installed_version?: string;
  restart_required: boolean;
  busy: boolean;
  restart_pending: boolean;
}

export type SessionRestartMode = 'now' | 'after-turn';
export type SessionRestartPhase = 'idle' | 'pending' | 'restarting' | 'complete';
