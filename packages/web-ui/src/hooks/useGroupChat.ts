import { useCallback, useEffect, useRef, useState } from 'react';
import { appendAcpEvent, type ByoMessage, type AvailableCommand } from '@clash/web-ui/lib/acpEvents';

/**
 * useGroupChat — multi-crew chat panel state.
 *
 * Each crew member the user has @-mentioned (or picked) gets its own
 * server-side runtime_session + browser WebSocket; this hook manages
 * the Map and exposes a tidy surface to the chat panel:
 *
 *   addCrew(crewId, opts)    spawn a new session for this crew member
 *   focus(crewId)            which crew's timeline the main panel shows
 *   sendToFocused(text)      send a prompt to the currently focused crew
 *
 * Each crew runs in its own per-project workspace cwd
 * (`~/.clash/crew/<id>/<project>/`), so concurrent crew don't see each
 * other's tool state.
 *
 * UI display contract: messages are KEPT PER-CREW (not interleaved
 * server-side). The chat panel renders the focused crew's `messages`
 * timeline as the main view, plus chips/avatars for the other crew
 * with unread indicators. Clicking another crew = focus switch =
 * different `messages` rendered.
 */

const RUNTIMES_PATH = '/api/v1/runtimes';
const SESSIONS_BASE = '/api/v1/local-sessions';

export type GroupChatStatus =
  | 'connecting'
  | 'connected'
  | 'sending'
  | 'streaming'
  | 'disconnected'
  | 'error';

export interface CrewSession {
  crewId: string;
  sessionId: string;
  status: GroupChatStatus;
  errorMessage: string | null;
  messages: ByoMessage[];
  availableCommands: AvailableCommand[];
  /** True iff this crew has new messages and the user isn't focused on it. */
  unread: boolean;
  /** Unix ms of the most recent inbound or outbound message. */
  lastActiveAt: number;
}

export interface UseGroupChatReturn {
  /** All crew currently in the conversation (any status). */
  crew: CrewSession[];
  /** Crew the main panel is rendering. */
  focusedCrewId: string | null;
  focusedCrew: CrewSession | null;
  /** Convenience: focused crew's messages, [] when nothing focused. */
  messages: ByoMessage[];
  /** True iff focused crew is sending/streaming — gates the input UI. */
  isProcessing: boolean;

  addCrew: (crewId: string, opts?: { resumeAcpSessionId?: string }) => Promise<void>;
  focus: (crewId: string) => void;
  removeCrew: (crewId: string) => void;
  sendToFocused: (text: string) => void;
  cancelFocused: () => void;
  /** Tear down everything (panel close, runtime change). */
  shutdown: () => void;
}

interface InternalCrewState extends CrewSession {
  /** WS to this crew's session stream. */
  ws: WebSocket | null;
  /** turnId → assistant-message bubble idx, for routing streamed events. */
  turnToMsgIdx: Map<string, number>;
}

export function useGroupChat(runtimeId: string | null, projectId?: string): UseGroupChatReturn {
  const [crew, setCrew] = useState<InternalCrewState[]>([]);
  const [focusedCrewId, setFocusedCrewId] = useState<string | null>(null);
  // Mirror state into a ref so stable callbacks can read the latest
  // without re-binding on every state change.
  const crewRef = useRef<InternalCrewState[]>([]);
  crewRef.current = crew;
  const turnSeq = useRef(0);

  // Tear down all WS on unmount or runtime change.
  useEffect(() => {
    return () => {
      for (const c of crewRef.current) {
        try { c.ws?.close(); } catch { /* ignore */ }
      }
    };
  }, []);

  // Runtime / project changed → blow away all crew sessions.
  useEffect(() => {
    setCrew((prev) => {
      for (const c of prev) {
        try { c.ws?.close(); } catch { /* */ }
      }
      return [];
    });
    setFocusedCrewId(null);
  }, [runtimeId, projectId]);

  /** Patch one crew's state by id. */
  const patchCrew = useCallback((crewId: string, patch: Partial<InternalCrewState>) => {
    setCrew((prev) => prev.map((c) => (c.crewId === crewId ? { ...c, ...patch } : c)));
  }, []);

  const focus = useCallback((crewId: string) => {
    setFocusedCrewId(crewId);
    // Clear unread when focusing.
    setCrew((prev) => prev.map((c) => (c.crewId === crewId ? { ...c, unread: false } : c)));
  }, []);

  const handleCrewMessage = useCallback((crewId: string, raw: unknown) => {
    let msg: { type: string; turn_id?: string; event?: unknown; message?: string; daemon_online?: boolean };
    try { msg = JSON.parse(typeof raw === 'string' ? raw : ''); }
    catch { return; }

    // Stamp activity / unread bookkeeping for any inbound traffic.
    const now = Date.now();

    if (msg.type === 'attached') return; // synthetic — handled elsewhere
    if (msg.type === 'session.ready') {
      patchCrew(crewId, { status: 'connected', lastActiveAt: now });
      return;
    }
    if (msg.type === 'session.event' && msg.turn_id) {
      setCrew((prev) => prev.map((c) => {
        if (c.crewId !== crewId) return c;
        const messages = c.messages.slice();
        const knownIdx = c.turnToMsgIdx.get(msg.turn_id!);
        const result = appendAcpEvent(messages, msg.turn_id!, knownIdx, msg.event);
        // Update turn map mutably (it's a ref in the state; replace the
        // whole map for immutability if needed — fine here).
        const newTurnMap = new Map(c.turnToMsgIdx);
        if (knownIdx === undefined && result.idx >= 0) newTurnMap.set(msg.turn_id!, result.idx);
        return {
          ...c,
          messages,
          turnToMsgIdx: newTurnMap,
          status: 'streaming' as const,
          availableCommands: result.commands ?? c.availableCommands,
          lastActiveAt: now,
          unread: focusedCrewId === c.crewId ? false : true,
        };
      }));
      return;
    }
    if (msg.type === 'session.complete' && msg.turn_id) {
      setCrew((prev) => prev.map((c) => {
        if (c.crewId !== crewId) return c;
        const newTurnMap = new Map(c.turnToMsgIdx);
        newTurnMap.delete(msg.turn_id!);
        return {
          ...c,
          turnToMsgIdx: newTurnMap,
          status: newTurnMap.size === 0 ? 'connected' as const : c.status,
          lastActiveAt: now,
        };
      }));
      return;
    }
    if (msg.type === 'session.error') {
      patchCrew(crewId, { status: 'error', errorMessage: msg.message ?? 'unknown error', lastActiveAt: now });
      return;
    }
    if (msg.type === 'session.disposed') {
      // Crew finished its work — remove from the panel. UI shows it
      // disappear; user can re-add later.
      setCrew((prev) => prev.filter((c) => c.crewId !== crewId));
      return;
    }
    if (msg.type === 'daemon_offline') {
      patchCrew(crewId, { status: 'disconnected', errorMessage: 'runtime offline' });
      return;
    }
  }, [focusedCrewId, patchCrew]);

  const addCrew = useCallback(async (crewId: string, opts?: { resumeAcpSessionId?: string }) => {
    if (!runtimeId) return;
    if (crewRef.current.some((c) => c.crewId === crewId)) {
      // Already in panel — just focus.
      focus(crewId);
      return;
    }

    // Optimistic insert with connecting status; UI shows the avatar
    // immediately so the user sees their click registered.
    setCrew((prev) => [
      ...prev,
      {
        crewId,
        sessionId: '',
        ws: null,
        status: 'connecting',
        errorMessage: null,
        messages: [],
        availableCommands: [],
        unread: false,
        lastActiveAt: Date.now(),
        turnToMsgIdx: new Map(),
      },
    ]);
    setFocusedCrewId(crewId);

    try {
      const res = await fetch(`${RUNTIMES_PATH}/${runtimeId}/sessions`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          crew_id: crewId,
          ...(projectId ? { project_id: projectId } : {}),
          ...(opts?.resumeAcpSessionId ? { resume_session_id: opts.resumeAcpSessionId } : {}),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        patchCrew(crewId, { status: 'error', errorMessage: `session create failed: ${text.slice(0, 200)}` });
        return;
      }
      const json = (await res.json()) as { session_id: string };
      patchCrew(crewId, { sessionId: json.session_id });

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(
        `${proto}//${window.location.host}${SESSIONS_BASE}/${encodeURIComponent(json.session_id)}/_stream`,
      );
      ws.onmessage = (ev) => handleCrewMessage(crewId, ev.data);
      ws.onclose = () => {
        // session.disposed already handles intentional teardown; this
        // covers transport drop. Keep crew in the list with disconnected
        // status so the user can see what happened.
        setCrew((prev) => prev.map((c) =>
          c.crewId === crewId
            ? { ...c, ws: null, status: c.status === 'error' ? c.status : 'disconnected' as const }
            : c,
        ));
      };
      patchCrew(crewId, { ws });
    } catch (e) {
      patchCrew(crewId, {
        status: 'error',
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }
  }, [runtimeId, projectId, focus, patchCrew, handleCrewMessage]);

  const removeCrew = useCallback((crewId: string) => {
    setCrew((prev) => {
      const target = prev.find((c) => c.crewId === crewId);
      if (target?.ws && target.ws.readyState === WebSocket.OPEN) {
        try { target.ws.send(JSON.stringify({ type: 'dispose' })); } catch { /* */ }
        try { target.ws.close(); } catch { /* */ }
      }
      const next = prev.filter((c) => c.crewId !== crewId);
      return next;
    });
    setFocusedCrewId((cur) => {
      if (cur !== crewId) return cur;
      const next = crewRef.current.find((c) => c.crewId !== crewId);
      return next?.crewId ?? null;
    });
  }, []);

  const sendToFocused = useCallback((text: string) => {
    if (!focusedCrewId) return;
    const target = crewRef.current.find((c) => c.crewId === focusedCrewId);
    if (!target?.ws || target.ws.readyState !== WebSocket.OPEN) return;
    const turnId = `t-${++turnSeq.current}-${Date.now().toString(36)}`;
    setCrew((prev) => prev.map((c) =>
      c.crewId === focusedCrewId
        ? {
            ...c,
            messages: [...c.messages, { id: `user-${turnId}`, role: 'user' as const, parts: [{ type: 'text' as const, text }] }],
            status: 'sending',
            lastActiveAt: Date.now(),
          }
        : c,
    ));
    target.ws.send(JSON.stringify({ type: 'prompt', turn_id: turnId, text }));
  }, [focusedCrewId]);

  const cancelFocused = useCallback(() => {
    if (!focusedCrewId) return;
    const target = crewRef.current.find((c) => c.crewId === focusedCrewId);
    if (!target?.ws || target.ws.readyState !== WebSocket.OPEN) return;
    for (const turnId of target.turnToMsgIdx.keys()) {
      target.ws.send(JSON.stringify({ type: 'cancel', turn_id: turnId }));
    }
  }, [focusedCrewId]);

  const shutdown = useCallback(() => {
    setCrew((prev) => {
      for (const c of prev) {
        if (c.ws && c.ws.readyState === WebSocket.OPEN) {
          try { c.ws.send(JSON.stringify({ type: 'dispose' })); } catch { /* */ }
          try { c.ws.close(); } catch { /* */ }
        }
      }
      return [];
    });
    setFocusedCrewId(null);
  }, []);

  const focusedCrew = focusedCrewId
    ? crew.find((c) => c.crewId === focusedCrewId) ?? null
    : null;

  // Strip internal-only fields from the public crew array.
  const publicCrew: CrewSession[] = crew.map(({ ws: _ws, turnToMsgIdx: _t, ...rest }) => {
    void _ws; void _t; return rest;
  });

  return {
    crew: publicCrew,
    focusedCrewId,
    focusedCrew: focusedCrew && (() => {
      const { ws: _ws, turnToMsgIdx: _t, ...rest } = focusedCrew;
      void _ws; void _t; return rest;
    })(),
    messages: focusedCrew?.messages ?? [],
    isProcessing:
      focusedCrew?.status === 'sending' ||
      focusedCrew?.status === 'streaming' ||
      focusedCrew?.status === 'connecting',
    addCrew,
    focus,
    removeCrew,
    sendToFocused,
    cancelFocused,
    shutdown,
  };
}
