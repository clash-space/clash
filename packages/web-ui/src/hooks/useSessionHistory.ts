import { useState, useCallback, useEffect, useRef } from "react";
import { runtimeApiUrl } from "../lib/runtimeConfig";

export interface SessionInfo {
  id?: string;
  threadId: string;
  title?: string;
  type: "cloud" | "runtime";
  projectId?: string;
  runtimeId?: string;
  agentId?: string;
  agentMemberId?: string;
  permissionMode?: string;
  acpSessionId?: string;
  status?: string;
  archivedAt?: string;
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

function mergeFetchedSessions(
  previous: SessionInfo[],
  fetched: SessionInfo[],
): SessionInfo[] {
  const previousByThreadId = new Map(
    previous.map((session) => [session.threadId, session]),
  );
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
  const fetchedThreadIds = new Set(
    normalizedFetched.map((session) => session.threadId),
  );
  const localOnlySessions = previous.filter(
    (session) => !fetchedThreadIds.has(session.threadId),
  );
  return [...localOnlySessions, ...normalizedFetched];
}

export function useSessionHistory(
  projectId?: string,
  options: { loadActive?: boolean } = {},
) {
  const loadActive = options.loadActive ?? Boolean(projectId);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<SessionInfo[]>([]);
  const [archiveStatus, setArchiveStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const sessionsRef = useRef(sessions);
  const archivedSessionsRef = useRef(archivedSessions);

  const replaceSessions = useCallback((next: SessionInfo[]) => {
    sessionsRef.current = next;
    setSessions(next);
  }, []);

  const replaceArchivedSessions = useCallback((next: SessionInfo[]) => {
    archivedSessionsRef.current = next;
    setArchivedSessions(next);
  }, []);

  useEffect(() => {
    if (!loadActive) return;
    const projectQuery = projectId
      ? `?projectId=${encodeURIComponent(projectId)}`
      : "";
    fetch(runtimeApiUrl(`/api/v1/sessions${projectQuery}`), {
      credentials: "include",
    })
      .then(async (res): Promise<SessionsResponse> =>
        res.ok ? ((await res.json()) as SessionsResponse) : { sessions: [] },
      )
      .then((data) => {
        setSessions((previous) => {
          const next = mergeFetchedSessions(previous, data.sessions || []);
          sessionsRef.current = next;
          return next;
        });
      })
      .catch(() => undefined);
  }, [loadActive, projectId]);

  // Upsert: the session was already persisted by the create/attach path.
  // This hook only keeps the in-panel history list current.
  const upsertSession = useCallback((session: SessionInfo) => {
    setSessions((prev) => {
      const exists = prev.some((s) => s.threadId === session.threadId);
      const next = exists
        ? prev.map((s) =>
            s.threadId === session.threadId ? { ...s, ...session } : s,
          )
        : [session, ...prev];
      sessionsRef.current = next;
      return next;
    });
  }, []);

  const loadArchivedSessions = useCallback(async () => {
    setArchiveStatus("loading");
    setArchiveError(null);
    try {
      const response = await fetch(
        runtimeApiUrl(
          projectId
            ? `/api/v1/sessions?projectId=${encodeURIComponent(projectId)}&archived=only`
            : "/api/v1/sessions?archived=only",
        ),
        { credentials: "include" },
      );
      if (!response.ok)
        throw new Error(
          `Failed to load archived sessions (${response.status})`,
        );
      const data = (await response.json()) as SessionsResponse;
      const next = (data.sessions ?? []).map(normalizeSession);
      replaceArchivedSessions(next);
      setArchiveStatus("ready");
    } catch (error) {
      setArchiveStatus("error");
      setArchiveError(error instanceof Error ? error.message : String(error));
    }
  }, [projectId, replaceArchivedSessions]);

  const setArchived = useCallback(
    async (threadId: string, archived: boolean) => {
      const previousActive = sessionsRef.current;
      const previousArchived = archivedSessionsRef.current;
      const source = (archived ? previousActive : previousArchived).find(
        (session) => session.threadId === threadId,
      );
      if (!source) return;

      if (archived) {
        const archivedSession = {
          ...source,
          archivedAt: new Date().toISOString(),
        };
        replaceSessions(
          previousActive.filter((session) => session.threadId !== threadId),
        );
        replaceArchivedSessions([
          archivedSession,
          ...previousArchived.filter(
            (session) => session.threadId !== threadId,
          ),
        ]);
      } else {
        const restoredSession = { ...source, archivedAt: undefined };
        replaceArchivedSessions(
          previousArchived.filter((session) => session.threadId !== threadId),
        );
        replaceSessions([
          restoredSession,
          ...previousActive.filter((session) => session.threadId !== threadId),
        ]);
      }

      try {
        const response = await fetch(
          runtimeApiUrl(`/api/v1/sessions/${encodeURIComponent(threadId)}`),
          {
            method: "PATCH",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ archived }),
          },
        );
        if (!response.ok)
          throw new Error(
            `Failed to ${archived ? "archive" : "restore"} session`,
          );
      } catch (error) {
        replaceSessions(previousActive);
        replaceArchivedSessions(previousArchived);
        throw error;
      }
    },
    [replaceArchivedSessions, replaceSessions],
  );

  const archiveSession = useCallback(
    (threadId: string) => setArchived(threadId, true),
    [setArchived],
  );

  const restoreSession = useCallback(
    (threadId: string) => setArchived(threadId, false),
    [setArchived],
  );

  // Delete: optimistic with rollback
  const deleteSession = useCallback(
    async (threadId: string) => {
      const previousActive = sessionsRef.current;
      const previousArchived = archivedSessionsRef.current;
      replaceSessions(previousActive.filter((s) => s.threadId !== threadId));
      replaceArchivedSessions(
        previousArchived.filter((s) => s.threadId !== threadId),
      );

      try {
        const response = await fetch(
          runtimeApiUrl(
            `/api/v1/sessions?threadId=${encodeURIComponent(threadId)}`,
          ),
          {
            method: "DELETE",
            credentials: "include",
          },
        );
        if (!response.ok) throw new Error("Failed to delete session");
      } catch (error) {
        replaceSessions(previousActive);
        replaceArchivedSessions(previousArchived);
        throw error;
      }
    },
    [replaceArchivedSessions, replaceSessions],
  );

  return {
    sessions,
    archivedSessions,
    archiveStatus,
    archiveError,
    upsertSession,
    loadArchivedSessions,
    archiveSession,
    restoreSession,
    deleteSession,
  };
}
