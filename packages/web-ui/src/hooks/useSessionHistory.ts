
import { useState, useCallback, useEffect, useRef } from 'react';

export interface SessionInfo {
  threadId: string;
  title?: string;
  updatedAt?: string;
}

export function useSessionHistory(projectId: string) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const loadedRef = useRef(false);

  // Load once per projectId
  useEffect(() => {
    loadedRef.current = false;
    fetch(`/api/v1/sessions?projectId=${encodeURIComponent(projectId)}`)
      .then(res => res.ok ? res.json() : { sessions: [] })
      .then(data => {
        setSessions(
          (data.sessions || []).map((s: any) => ({
            threadId: s.thread_id,
            title: s.title,
            updatedAt: s.updated_at,
          }))
        );
        loadedRef.current = true;
      })
      .catch(() => {
        setSessions([]);
        loadedRef.current = true;
      });
  }, [projectId]);

  // Upsert: update local state immediately, sync to D1 in background
  const upsertSession = useCallback((threadId: string, title: string) => {
    setSessions(prev => {
      const exists = prev.some(s => s.threadId === threadId);
      if (exists) {
        return prev.map(s => s.threadId === threadId ? { ...s, title } : s);
      }
      return [{ threadId, title }, ...prev];
    });

    fetch('/api/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, threadId, title }),
    }).catch(() => {});
  }, [projectId]);

  // Delete: optimistic with rollback
  const deleteSession = useCallback((threadId: string) => {
    const backup = [...sessions];
    setSessions(prev => prev.filter(s => s.threadId !== threadId));

    fetch(`/api/v1/sessions?threadId=${encodeURIComponent(threadId)}`, {
      method: 'DELETE',
    }).catch(() => {
      setSessions(backup);
    });
  }, [sessions]);

  return { sessions, upsertSession, deleteSession };
}
