import { useCallback, useEffect, useRef, useState } from 'react';
import { appendAcpEvent, type ByoMessage, type AvailableCommand } from '@clash/web-ui/lib/acpEvents';
import {
  loadCachedCrewMessages,
  saveCachedCrewMessages,
  clearCachedCrewMessages,
} from '../_group-chat/crewMsgCache';

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

/**
 * Pull persisted chat history for one local-runtime session and
 * replay it through the same `appendAcpEvent` parser the live WS
 * stream uses. Returns ready-to-render ByoMessage bubbles. The
 * server stores one row per turn (user prompt or assistant turn);
 * crew rows carry the raw daemon `event` objects, user rows carry
 * one-element parts already in ByoMessage shape.
 *
 * Returns null on transport error (caller falls back to cache) and
 * ByoMessage[] on success (including [] for an empty session) — the
 * empty case is meaningful: it means "server has no history for this
 * session", so we should NOT prefer a possibly-stale localStorage
 * cache (which can contain text from an earlier buggy merge that's
 * been frozen into JSON and survives indefinitely).
 */
async function fetchSessionHistory(sessionId: string, crewMemberId: string): Promise<ByoMessage[] | null> {
  let res: Response;
  try {
    res = await fetch(`${SESSIONS_BASE}/${encodeURIComponent(sessionId)}/messages`, {
      credentials: 'same-origin',
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let json: {
    messages?: Array<{
      id: string;
      sender_kind: 'user' | 'crew';
      sender_id: string;
      turn_id: string | null;
      events: unknown[];
      created_at: number;
    }>;
  };
  try {
    json = await res.json();
  } catch {
    return null;
  }
  const rows = json.messages ?? [];
  const bubbles: ByoMessage[] = [];
  for (const row of rows) {
    if (row.sender_kind === 'user') {
      // events is already [{type:'text',text:'...'}]; coerce defensively.
      const parts = (row.events ?? [])
        .map((p) => p as { type?: string; text?: string })
        .filter((p) => p?.type === 'text' && typeof p.text === 'string')
        .map((p) => ({ type: 'text' as const, text: p.text! }));
      bubbles.push({ id: row.id, role: 'user', parts });
      continue;
    }
    // Crew turn: replay raw events through the parser into a single
    // assistant bubble keyed by the turn id, mirroring how live events
    // populate the same bubble during streaming.
    const turnId = row.turn_id ?? row.id;
    let knownIdx: number | undefined;
    for (const ev of row.events ?? []) {
      const result = appendAcpEvent(bubbles, turnId, knownIdx, ev);
      if (knownIdx === undefined && result.idx >= 0) knownIdx = result.idx;
    }
  }
  void crewMemberId; // reserved for future per-crew filtering if needed
  return bubbles;
}

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
  /** WS dropped — auto-recovery in progress (exp-backoff or slow-poll
   *  session re-create). UI surfaces this as a pulsing dot so the user
   *  knows the system is working on it and doesn't trigger a manual
   *  uninvite/reinvite (which loses chat history). */
  | 'reconnecting'
  /** Recovery has hit a wall that needs human attention (no sessionId
   *  to retry against, etc). Surfaces the explicit Retry button. */
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

  // Mirror each crew's message transcript to localStorage so it survives
  // page reload. Server-side persistence of session events is the proper
  // fix; this is the local-only stop-gap so users don't see "No messages
  // yet" after every refresh. We compare against last-saved arrays so a
  // re-render that doesn't touch messages (status flip, unread bump,
  // etc.) doesn't churn the storage. See _group-chat/crewMsgCache.ts.
  const lastPersistedRef = useRef<Map<string, ByoMessage[]>>(new Map());
  useEffect(() => {
    if (!projectId) return;
    for (const c of crew) {
      const prev = lastPersistedRef.current.get(c.crewId);
      if (prev === c.messages) continue;
      // Don't persist an empty messages array — that's the initial /
      // post-replace state, NOT a user action. Writing [] would clobber
      // a populated cache we built up across previous sessions. Only
      // explicit removeCrew() clears the cache (via
      // clearCachedCrewMessages). This keeps cross-session continuity
      // even when a fresh server-side history fetch returns nothing.
      if (c.messages.length === 0) {
        lastPersistedRef.current.set(c.crewId, c.messages);
        continue;
      }
      saveCachedCrewMessages(projectId, c.crewId, c.messages);
      lastPersistedRef.current.set(c.crewId, c.messages);
    }
  }, [crew, projectId]);
  // Tracks crew ids the user has explicitly removed, so the onclose
  // reconnect path can distinguish "user wants this gone" from a
  // transport drop. Mutated synchronously inside removeCrew (refs, not
  // state) so the close event fires AFTER the flag is set.
  const removingRef = useRef<Set<string>>(new Set());
  /** crewId → reconnect attempt count. Reset to 0 on successful open. */
  const reconnectAttemptsRef = useRef<Map<string, number>>(new Map());
  /** crewId → pending setTimeout id, so retryCrew / removeCrew can cancel. */
  const reconnectTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /** Forward ref to `recoverCrewSession` — broken out so `openCrewWs`
   *  can call it from inside its `onclose` handler. `recoverCrewSession`
   *  itself calls `openCrewWs`, so we'd otherwise have a circular
   *  declaration. Set during render below. */
  const recoverCrewSessionRef = useRef<(crewId: string) => void>(() => {});

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
      // Daemon dropped — the *client* WS is still open against the DO,
      // so `ws.onclose` won't fire and the normal reconnect ladder
      // doesn't engage. Flip to 'reconnecting' (pulsing amber) so the
      // user sees something is being worked on, and arm the
      // slow-recovery loop so we're ready to grab a fresh session the
      // instant daemon_online comes back. The old session_id is dead
      // (ACP subprocess vanished with the daemon) — POSTing /sessions
      // is the only path to a working session, which is exactly what
      // recoverCrewSession does.
      patchCrew(crewId, {
        status: 'reconnecting',
        errorMessage: 'Runtime offline — waiting for daemon to come back',
      });
      recoverCrewSessionRef.current(crewId);
      return;
    }
    if (msg.type === 'daemon_online') {
      // Daemon came back. The current session_id is stale (it was
      // bound to the previous daemon instance which spawned an ACP
      // subprocess that's now gone). Trigger session recovery — the
      // 20s slow-poll loop already POSTs /sessions when daemon is up,
      // so a single nudge is enough. Don't preempt with a status set
      // here; recoverCrewSession owns the status transition.
      recoverCrewSessionRef.current(crewId);
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
        // Fast retries exhausted. Don't give up — switch to the
        // slow-recovery path: re-POST /sessions for a fresh session id
        // (the original may be dead on the daemon side if the runtime
        // restarted). recoverCrewSession is self-rescheduling: it polls
        // every ~20s until the runtime is back and the create succeeds,
        // at which point it re-opens a WS and resets the counter.
        // pendingPrompts queued during downtime drain automatically on
        // session.complete after recovery — user's @-mention catches up.
        recoverCrewSessionRef.current(crewId);
        return;
      }

      const delay = reconnectDelay(attempts);
      setCrew((prev) => prev.map((c) =>
        c.crewId === crewId
          ? { ...c, ws: null, status: 'reconnecting' as const, errorMessage: `Reconnecting (${attempts}/${MAX_RECONNECT_ATTEMPTS})…` }
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
    // immediately so the user sees their click registered. Restore any
    // cached message transcript from a previous tab/session so the panel
    // doesn't read as empty after reload (the WS event stream itself is
    // not server-persisted today; cache is the only continuity).
    const cachedMessages = projectId
      ? loadCachedCrewMessages(projectId, crewId)
      : [];
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
        messages: cachedMessages,
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

      // Replay persisted history BEFORE opening the WS. The server
      // stores every completed turn's event stream in
      // chat_message.events_json (see runtime-room.flushTurnToHistory).
      // Without this fetch, a freshly-opened crew tab only ever sees
      // events that arrive after the WS subscribes.
      //
      // Two persistence layers + one important asymmetry:
      //   • server history is keyed by session_id (one session = one
      //     POST /sessions = new id every invite). Fresh invites have
      //     no history at all.
      //   • localStorage cache (crewMsgCache) is keyed by
      //     (project_id, crew_member_id) and survives across
      //     session_ids. It's the only thing that carries forward
      //     work done in a previous tab/session.
      //
      // Resolution: history WINS when it has content (it's the
      // authoritative record for the live session, including any
      // turns we missed). When history is empty, KEEP the cache —
      // wiping it would erase cross-session memory and the user
      // would see "No messages" every time they re-invite a crew.
      const historyMessages = await fetchSessionHistory(json.session_id, claim.id);
      if (historyMessages !== null && historyMessages.length > 0) {
        patchCrew(crewId, { messages: historyMessages });
      }

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
    // User explicitly removed this crew → drop the cached transcript so
    // reinviting later starts fresh. Project-change tear-down keeps the
    // cache (you might come back to the project and want history).
    if (projectId) clearCachedCrewMessages(projectId, crewId);
    lastPersistedRef.current.delete(crewId);
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
  }, [projectId]);

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

  /**
   * Slow-recovery loop. Triggered after the WS reconnect ladder is
   * exhausted (5 quick attempts) — at that point the original session
   * id is almost certainly dead on the daemon side (it restarted, lost
   * in-memory ACP state). Rather than make the user uninvite + reinvite
   * (which would wipe localStorage history for this crew), we just
   * keep re-creating the session in the background until the runtime
   * answers.
   *
   * Cadence: try immediately on entry, then every 20s on failure. No
   * upper bound — the daemon may come back after a meeting, a laptop
   * lid open, a deploy, whatever. The status stays `'reconnecting'`
   * (pulsing amber dot) the whole time so the user knows recovery is
   * armed and doesn't tear the tab down. Any prompts queued via
   * `pendingPrompts` during the outage drain automatically once the
   * new session's `session.complete` fires.
   *
   * Cancellation: removeCrew sets removingRef, which the in-flight and
   * scheduled retries both check before doing anything.
   */
  const recoverCrewSession = useCallback((crewId: string) => {
    if (removingRef.current.has(crewId)) return;
    const target = crewRef.current.find((c) => c.crewId === crewId);
    if (!target) return;

    // Cancel any pending fast-retry timer; we own the schedule now.
    const pending = reconnectTimersRef.current.get(crewId);
    if (pending) {
      clearTimeout(pending);
      reconnectTimersRef.current.delete(crewId);
    }

    const tryOnce = async () => {
      if (removingRef.current.has(crewId)) return;
      if (!crewRef.current.some((c) => c.crewId === crewId)) return;
      patchCrew(crewId, {
        status: 'reconnecting',
        errorMessage: 'Restoring session — waiting for runtime…',
        ws: null,
      });
      try {
        const res = await fetch(`${RUNTIMES_PATH}/${target.runtimeId}/sessions`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            crew_member_id: crewId,
            ...(projectId ? { project_id: projectId } : {}),
          }),
        });
        if (!res.ok) {
          // Likely 409 runtime offline (daemon still gone) or a transient
          // 5xx. Either way: just wait + retry. Don't surface as an
          // error — the whole point of this loop is to be invisible
          // until the runtime is back.
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as { session_id: string };
        patchCrew(crewId, { sessionId: json.session_id });
        reconnectAttemptsRef.current.set(crewId, 0);
        openCrewWs(crewId, json.session_id);
        // Successful — don't schedule another attempt. If this WS
        // drops again, the normal onclose ladder will run from scratch.
      } catch {
        if (removingRef.current.has(crewId)) return;
        const t = setTimeout(() => {
          reconnectTimersRef.current.delete(crewId);
          void tryOnce();
        }, 20_000);
        reconnectTimersRef.current.set(crewId, t);
      }
    };

    void tryOnce();
  }, [projectId, openCrewWs, patchCrew]);

  // Keep the forward-declared ref in sync with the live function so
  // openCrewWs's onclose handler can reach it without a circular dep.
  recoverCrewSessionRef.current = recoverCrewSession;

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
