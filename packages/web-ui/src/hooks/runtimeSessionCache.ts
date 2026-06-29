import type { ByoMessage } from '../lib/acpEvents';

const MAX_MESSAGES_PER_SESSION = 200;

export interface RuntimeSessionCacheScope {
  projectId: string;
  runtimeId: string;
  agentMemberId?: string;
  agentId?: string | null;
}

export interface CachedRuntimeSession {
  acpSessionId?: string;
  messages: ByoMessage[];
  updatedAt: number;
}

function key(scope: RuntimeSessionCacheScope): string {
  return [
    'clash:runtimeSession',
    scope.projectId,
    scope.runtimeId,
    scope.agentMemberId ?? 'master-clash',
    scope.agentId ?? 'default',
  ].join(':');
}

export function loadCachedRuntimeSession(scope: RuntimeSessionCacheScope): CachedRuntimeSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedRuntimeSession>;
    return {
      ...(typeof parsed.acpSessionId === 'string' && parsed.acpSessionId.length > 0
        ? { acpSessionId: parsed.acpSessionId }
        : {}),
      messages: Array.isArray(parsed.messages) ? parsed.messages as ByoMessage[] : [],
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export function saveCachedRuntimeSession(
  scope: RuntimeSessionCacheScope,
  session: Omit<CachedRuntimeSession, 'updatedAt'>,
): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed =
      session.messages.length > MAX_MESSAGES_PER_SESSION
        ? session.messages.slice(session.messages.length - MAX_MESSAGES_PER_SESSION)
        : session.messages;
    window.localStorage.setItem(key(scope), JSON.stringify({
      ...(session.acpSessionId ? { acpSessionId: session.acpSessionId } : {}),
      messages: trimmed,
      updatedAt: Date.now(),
    }));
  } catch {
    // localStorage may be unavailable or full; chat still works for this run.
  }
}

export function clearCachedRuntimeSession(scope: RuntimeSessionCacheScope): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key(scope));
  } catch {
    // ignore
  }
}
