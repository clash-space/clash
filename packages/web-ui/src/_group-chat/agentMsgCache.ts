/**
 * localStorage-backed cache for per-agent message streams, scoped by
 * (projectId, agentMemberId).
 *
 * Agent session events (tool calls, streamed text, etc.) only live in
 * React state today — server doesn't persist them to D1 the way it does
 * for room messages. Refreshing the page or switching projects drops
 * the entire transcript, which is the "where did everything go?" UX
 * complaint.
 *
 * This cache is a low-cost mitigation: it's per-browser, doesn't sync
 * across devices, and isn't authoritative. It just survives reloads.
 * Real persistence belongs server-side (D1 + WS replay on attach), but
 * that's a bigger lift; this unblocks the day-to-day pain.
 *
 * Cap per agent at 200 messages. Long sessions truncate from the front
 * (oldest first) so we keep the recent context visible. Quota errors
 * are silent — UI just won't persist this round; next reload still
 * shows whatever did fit before.
 */

import type { ByoMessage } from '../lib/acpEvents';

const MAX_MESSAGES_PER_AGENT = 200;

const key = (projectId: string, agentMemberId: string) =>
  `clash:agentMsgs:${projectId}:${agentMemberId}`;

export function loadCachedAgentMessages(
  projectId: string,
  agentMemberId: string,
): ByoMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key(projectId, agentMemberId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as ByoMessage[]) : [];
  } catch {
    return [];
  }
}

export function saveCachedAgentMessages(
  projectId: string,
  agentMemberId: string,
  messages: ByoMessage[],
): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed =
      messages.length > MAX_MESSAGES_PER_AGENT
        ? messages.slice(messages.length - MAX_MESSAGES_PER_AGENT)
        : messages;
    window.localStorage.setItem(key(projectId, agentMemberId), JSON.stringify(trimmed));
  } catch {
    // Quota exceeded / disabled — silent. Worst case: this turn's
    // messages don't survive reload; the next persisted batch fixes
    // it once trim brings the total back under quota.
  }
}

export function clearCachedAgentMessages(
  projectId: string,
  agentMemberId: string,
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key(projectId, agentMemberId));
  } catch {
    // ignore
  }
}
