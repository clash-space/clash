import { useState, useCallback, useEffect } from 'react';
import { runtimeApiUrl } from '../lib/runtimeConfig';

export interface SessionInfo {
  id?: string;
  threadId: string;
  title?: string;
  type: 'cloud' | 'runtime';
  projectId?: string;
  runtimeId?: string;
  agentId?: string;
  agentMemberId?: string;
  permissionMode?: string;
  acpSessionId?: string;
  status?: string;
  updatedAt?: string;
}

type SessionsResponse = {
  sessions?: SessionInfo[];
};

function normalizeSession(session: SessionInfo): SessionInfo {
  return {
    ...session,
    id: session.id ?? session.threadId,
  };
}

function mergeFetchedSessions(previous: SessionInfo[], fetched: SessionInfo[]): SessionInfo[] {
  const previousByThreadId = new Map(previous.map((session) => [session.threadId, session]));
  const normalizedFetched = fetched.map((session) => {
    const normalized = normalizeSession(session);
    const existing = previousByThreadId.get(normalized.threadId);
    if (!existing) return normalized;
    return {
      ...existing,
      ...normalized,
      title: normalized.title?.trim() ? normalized.title : existing.title,
    };
  });
  const fetchedThreadIds = new Set(normalizedFetched.map((session) => session.threadId));
  const localOnlySessions = previous.filter((session) => !fetchedThreadIds.has(session.threadId));
  return [...localOnlySessions, ...normalizedFetched];
}

export function useSessionHistory(projectId: string) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  useEffect(() => {
    fetch(runtimeApiUrl(`/api/v1/sessions?projectId=${encodeURIComponent(projectId)}`), {
      credentials: 'include',
    })
      .then(async (res): Promise<SessionsResponse> => res.ok ? await res.json() as SessionsResponse : { sessions: [] })
      .then((data) => {
        setSessions((previous) => mergeFetchedSessions(previous, data.sessions || []));
      })
      .catch(() => undefined);
  }, [projectId]);

  // Upsert: the session was already persisted by the create/attach path.
  // This hook only keeps the in-panel history list current.
  const upsertSession = useCallback((session: SessionInfo) => {
    setSessions(prev => {
      const exists = prev.some(s => s.threadId === session.threadId);
      if (exists) {
        return prev.map(s => s.threadId === session.threadId ? { ...s, ...session } : s);
      }
      return [session, ...prev];
    });
  }, []);

  // Delete: optimistic with rollback
  const deleteSession = useCallback((threadId: string) => {
    const backup = [...sessions];
    setSessions(prev => prev.filter(s => s.threadId !== threadId));

    fetch(runtimeApiUrl(`/api/v1/sessions?threadId=${encodeURIComponent(threadId)}`), {
      method: 'DELETE',
      credentials: 'include',
    })
      .then((res) => {
        if (!res.ok) setSessions(backup);
      })
      .catch(() => {
        setSessions(backup);
      });
  }, [sessions]);

  return { sessions, upsertSession, deleteSession };
}
