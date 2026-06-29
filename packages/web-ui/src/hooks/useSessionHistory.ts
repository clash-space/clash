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

export function useSessionHistory(projectId: string) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  useEffect(() => {
    fetch(runtimeApiUrl(`/api/v1/sessions?projectId=${encodeURIComponent(projectId)}`), {
      credentials: 'include',
    })
      .then(async (res): Promise<SessionsResponse> => res.ok ? await res.json() as SessionsResponse : { sessions: [] })
      .then((data) => {
        setSessions((data.sessions || []).map((session) => ({
          ...session,
          id: session.id ?? session.threadId,
        })));
      })
      .catch(() => {
        setSessions([]);
      });
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
