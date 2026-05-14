import { useCallback, useEffect, useRef, useState } from 'react';
import { appendAcpEvent, type ByoMessage, type AvailableCommand } from '@clash/web-ui/lib/acpEvents';

/**
 * useGroupChat — multi-crew chat panel state.
 *
 * Phase 2: identity is the **claimed crew_member.id**, not the bundled
 * template id. Caller passes the crew_member objects (id + runtime +
 * display name); this hook spawns a runtime_session per claimed member
 * the user wants in the chat. addCrew(crewMemberId) → POST /sessions
 * with crew_member_id; server resolves to template + runtime via the
 * claim row.
 *
 * Each crew runs in its own per-project workspace cwd
 * (`~/.clash/crew/<template>/<project>/`), so concurrent crew don't
 * see each other's tool state.
 *
 * UI contract: messages are KEPT PER-CREW (not interleaved server-
 * side). The chat panel renders the focused crew's `messages` timeline
 * as the main view, plus avatars for the other crew with unread
 * indicators. Clicking another crew = focus switch = different
 * `messages` rendered.
 */

const RUNTIMES_PATH = '/api/v1/runtimes';
const SESSIONS_BASE = '/api/v1/local-sessions';

/** Caller passes this — usually fetched from /api/v1/crew. */
export interface ClaimedCrew {
  id: string;             // crew_member.id — the identity we use everywhere
  template_id: string;
  runtime_id: string;
  display_name: string;
}

export type GroupChatStatus =
  | 'connecting'
  | 'connected'
  | 'sending'
  | 'streaming'
  | 'disconnected'
  | 'error';

export interface CrewSession {
  /** crew_member.id — stable identity across the chat (formerly template id). */
  crewId: string;
  /** Server-side runtime_session.id, "" until POST /sessions returns. */
  sessionId: string;
  /** Mirror of the claim metadata for convenience in the UI. */
  templateId: string;
  runtimeId: string;
  displayName: string;
  status: GroupChatStatus;
  errorMessage: string | null;
  messages: ByoMessage[];
  availableCommands: AvailableCommand[];
  /** True iff this crew has new messages and the user isn't focused on it. */
  unread: boolean;
  /** Unix ms of the most recent inbound or outbound message. */
  lastActiveAt: number;
  /** Number of room.mention prompts queued for the next-turn drain. */
  pendingPrompts: string[];
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

  addCrew: (claim: ClaimedCrew, opts?: { resumeAcpSessionId?: string }) => Promise<void>;
  focus: (crewId: string) => void;
  removeCrew: (crewId: string) => void;
  /** Re-establish the WS session for an existing (errored / disconnected)
   *  crew without removing + re-adding it. Wired by the CrewView retry
   *  button. Optional until task #10 lands the implementation. */
  retryCrew?: (crewId: string) => void;
  sendToFocused: (text: string) => void;
  cancelFocused: () => void;
  /** Tear down everything (panel close, project change). */
  shutdown: () => void;
}

interface InternalCrewState extends CrewSession {
  /** WS to this crew's session stream. */
  ws: WebSocket | null;
  /** turnId → assistant-message bubble idx, for routing streamed events. */
  turnToMsgIdx: Map<string, number>;
  /**
   * Prompts queued by inbound room.mention frames. Drained one-per-
   * turn on session.complete (append-on-next-turn semantics — never
   * interrupts an in-flight turn). UI doesn't render these; the user-
   * message bubble appears once the prompt actually goes out.
   */
  pendingPrompts: string[];
}

/** Cap on auto-reconnect attempts before we give up and surface the
 *  retry button in CrewView. Five attempts at exp backoff gives roughly
 *  60s of "is the network back?" before we stop and ask the user. */
const MAX_RECONNECT_ATTEMPTS = 5;

/** Exponential backoff: 1s, 2s, 4s, 8s, 16s, then capped at 30s. */
function reconnectDelay(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), 30_000);
}

export function useGroupChat(projectId?: string): UseGroupChatReturn {
  const [crew, setCrew] = useState<InternalCrewState[]>([]);
  const [focusedCrewId, setFocusedCrewId] = useState<string | null>(null);
  // Mirror state into a ref so stable callbacks can read the latest
  // without re-binding on every state change.
  const crewRef = useRef<InternalCrewState[]>([]);
  crewRef.current = crew;
  const turnSeq = useRef(0);
  // Tracks crew ids the user has explicitly removed, so the onclose
  // reconnect path can distinguish "user wants this gone" from a
  // transport drop. Mutated synchronously inside removeCrew (refs, not
  // state) so the close event fires AFTER the flag is set.
  const removingRef = useRef<Set<string>>(new Set());
  /** crewId → reconnect attempt count. Reset to 0 on successful open. */
  const reconnectAttemptsRef = useRef<Map<string, number>>(new Map());
  /** crewId → pending setTimeout id, so retryCrew / removeCrew can cancel. */
  const reconnectTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Tear down all WS on unmount or runtime change.
  useEffect(() => {
    return () => {
      for (const c of crewRef.current) {
        try { c.ws?.close(); } catch { /* ignore */ }
      }
      for (const t of reconnectTimersRef.current.values()) clearTimeout(t);
      reconnectTimersRef.current.clear();
    };
  }, []);

  // Project changed → blow away all crew sessions. (Runtime is now
  // per-crew; there's no panel-wide runtime to react to.)
  useEffect(() => {
    setCrew((prev) => {
      for (const c of prev) {
        try { c.ws?.close(); } catch { /* */ }
      }
      return [];
    });
    setFocusedCrewId(null);
  }, [projectId]);

  /** Patch one crew's state by id. */
  const patchCrew = useCallback((crewId: string, patch: Partial<InternalCrewState>) => {
    setCrew((prev) => prev.map((c) => (c.crewId === crewId ? { ...c, ...patch } : c)));
  }, []);

  const focus = useCallback((crewId: string) => {
    setFocusedCrewId(crewId);
    // Clear unread when focusing.
    setCrew((prev) => prev.map((c) => (c.crewId === crewId ? { ...c, unread: false } : c)));
  }, []);

  /**
   * Send one prompt to a crew's session. Internal helper — used by
   * sendToFocused (immediate, with optimistic user-message bubble) and
   * by drainPending (after session.complete fires, room.mention queue).
   */
  const dispatchPrompt = useCallback((crewId: string, text: string, withUserBubble: boolean) => {
    const target = crewRef.current.find((c) => c.crewId === crewId);
    if (!target?.ws || target.ws.readyState !== WebSocket.OPEN) return;
    const turnId = `t-${++turnSeq.current}-${Date.now().toString(36)}`;
    setCrew((prev) => prev.map((c) =>
      c.crewId === crewId
        ? {
            ...c,
            messages: withUserBubble
              ? [...c.messages, { id: `user-${turnId}`, role: 'user' as const, parts: [{ type: 'text' as const, text }] }]
              : c.messages,
            status: 'sending',
            lastActiveAt: Date.now(),
          }
        : c,
    ));
    target.ws.send(JSON.stringify({ type: 'prompt', turn_id: turnId, text }));
  }, []);

  /**
   * If a crew is idle and has queued room.mentions, send the next one.
   * Called from session.complete handler. Append-on-next-turn — never
   * interrupts.
   */
  const drainPending = useCallback((crewId: string) => {
    const target = crewRef.current.find((c) => c.crewId === crewId);
    if (!target) return;
    if (target.turnToMsgIdx.size > 0) return; // still in a turn
    if (target.pendingPrompts.length === 0) return;
    const next = target.pendingPrompts[0];
    setCrew((prev) => prev.map((c) =>
      c.crewId === crewId ? { ...c, pendingPrompts: c.pendingPrompts.slice(1) } : c,
    ));
    dispatchPrompt(crewId, next, true);
  }, [dispatchPrompt]);

  const handleCrewMessage = useCallback((crewId: string, raw: unknown) => {
    let msg: {
      type: string;
      turn_id?: string;
      event?: unknown;
      message?: string;
      daemon_online?: boolean;
      // room.mention payload (forwarded by server's pushRoomMention)
      message_id?: string;
      from_kind?: string;
      from_id?: string;
      from_user_id?: string;
      text?: string;
    };
    try { msg = JSON.parse(typeof raw === 'string' ? raw : ''); }
    catch { return; }

    // Stamp activity / unread bookkeeping for any inbound traffic.
    const now = Date.now();

    if (msg.type === 'attached') return; // synthetic — handled elsewhere
    if (msg.type === 'session.ready') {
      patchCrew(crewId, { status: 'connected', lastActiveAt: now });
      // If a mention got queued before the WS opened, drain on ready.
      drainPending(crewId);
      return;
    }
    if (msg.type === 'session.event' && msg.turn_id) {
      setCrew((prev) => prev.map((c) => {
        if (c.crewId !== crewId) return c;
        const messages = c.messages.slice();
        const knownIdx = c.turnToMsgIdx.get(msg.turn_id!);
        const result = appendAcpEvent(messages, msg.turn_id!, knownIdx, msg.event);
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
      // Queue drain runs AFTER the state flip so its idle check sees
      // the right value. Microtask is enough; no need to wait for paint.
      queueMicrotask(() => drainPending(crewId));
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
    if (msg.type === 'room.mention' && typeof msg.text === 'string') {
      // Server-side pushRoomMention forwarded a room message that
      // tagged this crew. Format with sender header so the agent has
      // context, then queue. If the crew is idle, drain immediately;
      // otherwise it goes out on the next session.complete.
      const sender = msg.from_kind === 'user' ? `[room from human] ` : `[room from ${msg.from_id ?? 'crew'}] `;
      const body = `${sender}${msg.text}`;
      setCrew((prev) => prev.map((c) =>
        c.crewId === crewId
          ? { ...c, pendingPrompts: [...c.pendingPrompts, body], lastActiveAt: now }
          : c,
      ));
      // Defer to next macrotask: setCrew schedules a re-render, but
      // crewRef.current is mutated only on the NEXT render's body.
      // Calling drainPending synchronously (or via microtask — runs
      // before React commits) reads stale crewRef state where
      // pendingPrompts is still empty, drain bails, and the prompt
      // stays queued forever (until the next session.complete, which
      // never comes if the crew is idle). setTimeout(0) gives React
      // a chance to flush the commit phase first.
      setTimeout(() => drainPending(crewId), 0);
      return;
    }
  }, [focusedCrewId, patchCrew, drainPending]);

  /**
   * Open (or re-open) the WS stream for an existing crew + session id.
   * Extracted so both initial connect (from addCrew) and reconnect /
   * retry paths share the same lifecycle wiring. On unexpected close,
   * schedules an exponential-backoff reconnect up to MAX_RECONNECT_ATTEMPTS;
   * after that the crew lands in `disconnected` with a Retry button on
   * the CrewView header.
   */
  const openCrewWs = useCallback((crewId: string, sessionId: string) => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${proto}//${window.location.host}${SESSIONS_BASE}/${encodeURIComponent(sessionId)}/_stream`,
    );
    ws.onmessage = (ev) => handleCrewMessage(crewId, ev.data);
    ws.onopen = () => {
      // Reset backoff counter on successful re-attach. Status flips to
      // 'connected' once the server's session.ready event arrives via
      // handleCrewMessage — don't pre-empt that here.
      reconnectAttemptsRef.current.set(crewId, 0);
    };
    ws.onclose = () => {
      // Intentional removal? Don't reconnect.
      if (removingRef.current.has(crewId)) return;
      const attempts = (reconnectAttemptsRef.current.get(crewId) ?? 0) + 1;
      reconnectAttemptsRef.current.set(crewId, attempts);

      if (attempts > MAX_RECONNECT_ATTEMPTS) {
        // Give up; surface to the user via the Retry button in CrewView.
        setCrew((prev) => prev.map((c) =>
          c.crewId === crewId
            ? { ...c, ws: null, status: c.status === 'error' ? c.status : 'disconnected' as const, errorMessage: `Lost connection after ${MAX_RECONNECT_ATTEMPTS} attempts. Click Retry.` }
            : c,
        ));
        return;
      }

      const delay = reconnectDelay(attempts);
      setCrew((prev) => prev.map((c) =>
        c.crewId === crewId
          ? { ...c, ws: null, status: 'disconnected' as const, errorMessage: `Reconnecting (${attempts}/${MAX_RECONNECT_ATTEMPTS})…` }
          : c,
      ));
      const t = setTimeout(() => {
        reconnectTimersRef.current.delete(crewId);
        if (removingRef.current.has(crewId)) return;
        // Bail if the crew was removed from state between schedule and fire.
        if (!crewRef.current.some((c) => c.crewId === crewId)) return;
        openCrewWs(crewId, sessionId);
      }, delay);
      reconnectTimersRef.current.set(crewId, t);
    };
    patchCrew(crewId, { ws });
  }, [handleCrewMessage, patchCrew]);

  const addCrew = useCallback(async (claim: ClaimedCrew, opts?: { resumeAcpSessionId?: string }) => {
    const crewId = claim.id; // crew_member.id is the in-panel identity
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
        templateId: claim.template_id,
        runtimeId: claim.runtime_id,
        displayName: claim.display_name,
        ws: null,
        status: 'connecting',
        errorMessage: null,
        messages: [],
        availableCommands: [],
        unread: false,
        lastActiveAt: Date.now(),
        turnToMsgIdx: new Map(),
        pendingPrompts: [],
      },
    ]);
    setFocusedCrewId(crewId);

    try {
      const res = await fetch(`${RUNTIMES_PATH}/${claim.runtime_id}/sessions`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          crew_member_id: claim.id,
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
      // Clear any stale removal flag from a previous lifecycle so the
      // new connection's onclose path doesn't get short-circuited.
      removingRef.current.delete(crewId);
      reconnectAttemptsRef.current.set(crewId, 0);
      openCrewWs(crewId, json.session_id);
    } catch (e) {
      patchCrew(crewId, {
        status: 'error',
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }
  }, [projectId, focus, patchCrew, openCrewWs]);

  const removeCrew = useCallback((crewId: string) => {
    // Set BEFORE closing the WS so the close handler sees the flag and
    // skips the reconnect path.
    removingRef.current.add(crewId);
    const pending = reconnectTimersRef.current.get(crewId);
    if (pending) {
      clearTimeout(pending);
      reconnectTimersRef.current.delete(crewId);
    }
    reconnectAttemptsRef.current.delete(crewId);
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

  /** User-triggered reconnect for an errored / disconnected crew. Cancels
   *  any pending backoff timer and immediately opens a fresh WS to the
   *  existing session id. If the session id is missing (we never got past
   *  POST /sessions), there's nothing to retry — caller should removeCrew
   *  + re-add instead. */
  const retryCrew = useCallback((crewId: string) => {
    const target = crewRef.current.find((c) => c.crewId === crewId);
    if (!target || !target.sessionId) return;
    const pending = reconnectTimersRef.current.get(crewId);
    if (pending) {
      clearTimeout(pending);
      reconnectTimersRef.current.delete(crewId);
    }
    reconnectAttemptsRef.current.set(crewId, 0);
    patchCrew(crewId, { status: 'connecting', errorMessage: null });
    openCrewWs(crewId, target.sessionId);
  }, [openCrewWs, patchCrew]);

  const sendToFocused = useCallback((text: string) => {
    if (!focusedCrewId) return;
    dispatchPrompt(focusedCrewId, text, true);
  }, [focusedCrewId, dispatchPrompt]);

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

  // Strip internal-only fields from the public crew array. (pendingPrompts
  // intentionally exposed — UI wants to show "N pending" indicator.)
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
    retryCrew,
    sendToFocused,
    cancelFocused,
    shutdown,
  };
}
