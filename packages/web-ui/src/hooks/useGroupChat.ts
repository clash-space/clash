import { useCallback, useEffect, useRef, useState } from 'react';
import { appendAcpEvent, type ByoMessage, type AvailableCommand } from '@clash/web-ui/lib/acpEvents';
import {
  loadCachedAgentMessages,
  saveCachedAgentMessages,
  clearCachedAgentMessages,
} from '../_group-chat/agentMsgCache';
import { runtimeApiUrl, runtimeWebSocketUrl } from '../lib/runtimeConfig';

/**
 * useGroupChat — multi-agent chat panel state.
 *
 * Phase 2: identity is the **claimed agent_member.id**, not the bundled
 * template id. Caller passes the agent_member objects (id + runtime +
 * display name); this hook spawns a runtime_session per claimed member
 * the user wants in the chat. addAgent(agentMemberId) → POST /sessions
 * with agent_member_id; server resolves to template + runtime via the
 * claim row.
 *
 * Each agent runs in the project workspace cwd
 * (`~/.clash/projects/<project>/`), so every session sees the same
 * project files while agent identity stays in env/config.
 *
 * UI contract: messages are KEPT PER-AGENT (not interleaved server-
 * side). The chat panel renders the focused agent's `messages` timeline
 * as the main view, plus avatars for the other agent with unread
 * indicators. Clicking another agent = focus switch = different
 * `messages` rendered.
 */

const RUNTIMES_PATH = '/api/v1/runtimes';
const SESSIONS_BASE = '/api/v1/local-sessions';

/**
 * Pull persisted chat history for one local-runtime session and
 * replay it through the same `appendAcpEvent` parser the live WS
 * stream uses. Returns ready-to-render ByoMessage bubbles. The
 * server stores one row per turn (user prompt or assistant turn);
 * agent rows carry the raw daemon `event` objects, user rows carry
 * one-element parts already in ByoMessage shape.
 *
 * Returns null on transport error (caller falls back to cache) and
 * ByoMessage[] on success (including [] for an empty session) — the
 * empty case is meaningful: it means "server has no history for this
 * session", so we should NOT prefer a possibly-stale localStorage
 * cache (which can contain text from an earlier buggy merge that's
 * been frozen into JSON and survives indefinitely).
 */
async function fetchSessionHistory(sessionId: string, agentMemberId: string): Promise<ByoMessage[] | null> {
  let res: Response;
  try {
    res = await fetch(runtimeApiUrl(`${SESSIONS_BASE}/${encodeURIComponent(sessionId)}/messages`), {
      credentials: 'include',
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let json: {
    messages?: Array<{
      id: string;
      sender_kind: 'user' | 'agent';
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
    // Agent turn: replay raw events through the parser into a single
    // assistant bubble keyed by the turn id, mirroring how live events
    // populate the same bubble during streaming.
    const turnId = row.turn_id ?? row.id;
    let knownIdx: number | undefined;
    for (const ev of row.events ?? []) {
      const result = appendAcpEvent(bubbles, turnId, knownIdx, ev);
      if (knownIdx === undefined && result.idx >= 0) knownIdx = result.idx;
    }
  }
  void agentMemberId; // reserved for future per-agent filtering if needed
  return bubbles;
}

/** Caller passes this — usually fetched from /api/v1/agents. */
export interface ClaimedAgent {
  id: string;             // agent_member.id — the identity we use everywhere
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

export interface AgentSession {
  /** agent_member.id — stable identity across the chat (formerly template id). */
  agentMemberId: string;
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
  /** True iff this agent has new messages and the user isn't focused on it. */
  unread: boolean;
  /** Unix ms of the most recent inbound or outbound message. */
  lastActiveAt: number;
  /** Number of room.mention prompts queued for the next-turn drain. */
  pendingPrompts: string[];
}

export interface UseGroupChatReturn {
  /** All agent currently in the conversation (any status). */
  agent: AgentSession[];
  /** Agent the main panel is rendering. */
  focusedAgentId: string | null;
  focusedAgent: AgentSession | null;
  /** Convenience: focused agent's messages, [] when nothing focused. */
  messages: ByoMessage[];
  /** True iff focused agent is sending/streaming — gates the input UI. */
  isProcessing: boolean;

  addAgent: (claim: ClaimedAgent, opts?: { resumeAcpSessionId?: string }) => Promise<void>;
  focus: (agentMemberId: string) => void;
  removeAgent: (agentMemberId: string) => void;
  /** Re-establish the WS session for an existing (errored / disconnected)
   *  agent without removing + re-adding it. Wired by the AgentView retry
   *  button. Optional until task #10 lands the implementation. */
  retryAgent?: (agentMemberId: string) => void;
  sendToFocused: (text: string) => void;
  cancelFocused: () => void;
  /** Tear down everything (panel close, project change). */
  shutdown: () => void;
}

export interface GroupChatSessionEvent {
  agentMemberId: string;
  sessionId: string;
  turnId: string;
  event: unknown;
}

export interface UseGroupChatOptions {
  onSessionEvent?: (event: GroupChatSessionEvent) => void;
}

interface InternalAgentState extends AgentSession {
  /** WS to this agent's session stream. */
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
 *  retry button in AgentView. Five attempts at exp backoff gives roughly
 *  60s of "is the network back?" before we stop and ask the user. */
const MAX_RECONNECT_ATTEMPTS = 5;

/** Exponential backoff: 1s, 2s, 4s, 8s, 16s, then capped at 30s. */
function reconnectDelay(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), 30_000);
}

export function useGroupChat(projectId?: string, options: UseGroupChatOptions = {}): UseGroupChatReturn {
  const [agent, setAgent] = useState<InternalAgentState[]>([]);
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null);
  // Mirror state into a ref so stable callbacks can read the latest
  // without re-binding on every state change.
  const agentRef = useRef<InternalAgentState[]>([]);
  agentRef.current = agent;
  const onSessionEventRef = useRef(options.onSessionEvent);
  onSessionEventRef.current = options.onSessionEvent;
  const turnSeq = useRef(0);

  // Mirror each agent's message transcript to localStorage so it survives
  // page reload. Server-side persistence of session events is the proper
  // fix; this is the local-only stop-gap so users don't see "No messages
  // yet" after every refresh. We compare against last-saved arrays so a
  // re-render that doesn't touch messages (status flip, unread bump,
  // etc.) doesn't churn the storage. See _group-chat/agentMsgCache.ts.
  const lastPersistedRef = useRef<Map<string, ByoMessage[]>>(new Map());
  useEffect(() => {
    if (!projectId) return;
    for (const c of agent) {
      const prev = lastPersistedRef.current.get(c.agentMemberId);
      if (prev === c.messages) continue;
      // Don't persist an empty messages array — that's the initial /
      // post-replace state, NOT a user action. Writing [] would clobber
      // a populated cache we built up across previous sessions. Only
      // explicit removeAgent() clears the cache (via
      // clearCachedAgentMessages). This keeps cross-session continuity
      // even when a fresh server-side history fetch returns nothing.
      if (c.messages.length === 0) {
        lastPersistedRef.current.set(c.agentMemberId, c.messages);
        continue;
      }
      saveCachedAgentMessages(projectId, c.agentMemberId, c.messages);
      lastPersistedRef.current.set(c.agentMemberId, c.messages);
    }
  }, [agent, projectId]);
  // Tracks agent ids the user has explicitly removed, so the onclose
  // reconnect path can distinguish "user wants this gone" from a
  // transport drop. Mutated synchronously inside removeAgent (refs, not
  // state) so the close event fires AFTER the flag is set.
  const removingRef = useRef<Set<string>>(new Set());
  /** agentMemberId → reconnect attempt count. Reset to 0 on successful open. */
  const reconnectAttemptsRef = useRef<Map<string, number>>(new Map());
  /** agentMemberId → pending setTimeout id, so retryAgent / removeAgent can cancel. */
  const reconnectTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /** Forward ref to `recoverAgentSession` — broken out so `openAgentWs`
   *  can call it from inside its `onclose` handler. `recoverAgentSession`
   *  itself calls `openAgentWs`, so we'd otherwise have a circular
   *  declaration. Set during render below. */
  const recoverAgentSessionRef = useRef<(agentMemberId: string) => void>(() => {});

  // Tear down all WS on unmount or runtime change.
  useEffect(() => {
    return () => {
      for (const c of agentRef.current) {
        try { c.ws?.close(); } catch { /* ignore */ }
      }
      for (const t of reconnectTimersRef.current.values()) clearTimeout(t);
      reconnectTimersRef.current.clear();
    };
  }, []);

  // Project changed → blow away all agent sessions. (Runtime is now
  // per-agent; there's no panel-wide runtime to react to.)
  useEffect(() => {
    setAgent((prev) => {
      for (const c of prev) {
        try { c.ws?.close(); } catch { /* */ }
      }
      return [];
    });
    setFocusedAgentId(null);
  }, [projectId]);

  /** Patch one agent's state by id. */
  const patchAgent = useCallback((agentMemberId: string, patch: Partial<InternalAgentState>) => {
    setAgent((prev) => prev.map((c) => (c.agentMemberId === agentMemberId ? { ...c, ...patch } : c)));
  }, []);

  const focus = useCallback((agentMemberId: string) => {
    setFocusedAgentId(agentMemberId);
    // Clear unread when focusing.
    setAgent((prev) => prev.map((c) => (c.agentMemberId === agentMemberId ? { ...c, unread: false } : c)));
  }, []);

  /**
   * Send one prompt to a agent's session. Internal helper — used by
   * sendToFocused (immediate, with optimistic user-message bubble) and
   * by drainPending (after session.complete fires, room.mention queue).
   */
  const dispatchPrompt = useCallback((agentMemberId: string, text: string, withUserBubble: boolean) => {
    const target = agentRef.current.find((c) => c.agentMemberId === agentMemberId);
    if (!target?.ws || target.ws.readyState !== WebSocket.OPEN) return;
    const turnId = `t-${++turnSeq.current}-${Date.now().toString(36)}`;
    setAgent((prev) => prev.map((c) =>
      c.agentMemberId === agentMemberId
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
   * If a agent is idle and has queued room.mentions, send the next one.
   * Called from session.complete handler. Append-on-next-turn — never
   * interrupts.
   */
  const drainPending = useCallback((agentMemberId: string) => {
    const target = agentRef.current.find((c) => c.agentMemberId === agentMemberId);
    if (!target) return;
    if (target.turnToMsgIdx.size > 0) return; // still in a turn
    if (target.pendingPrompts.length === 0) return;
    const next = target.pendingPrompts[0];
    setAgent((prev) => prev.map((c) =>
      c.agentMemberId === agentMemberId ? { ...c, pendingPrompts: c.pendingPrompts.slice(1) } : c,
    ));
    dispatchPrompt(agentMemberId, next, true);
  }, [dispatchPrompt]);

  const handleAgentMessage = useCallback((agentMemberId: string, raw: unknown) => {
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
      patchAgent(agentMemberId, { status: 'connected', lastActiveAt: now });
      // If a mention got queued before the WS opened, drain on ready.
      drainPending(agentMemberId);
      return;
    }
    if (msg.type === 'session.event' && msg.turn_id) {
      const target = agentRef.current.find((c) => c.agentMemberId === agentMemberId);
      if (target) {
        onSessionEventRef.current?.({
          agentMemberId,
          sessionId: target.sessionId,
          turnId: msg.turn_id,
          event: msg.event,
        });
      }
      setAgent((prev) => prev.map((c) => {
        if (c.agentMemberId !== agentMemberId) return c;
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
          unread: focusedAgentId === c.agentMemberId ? false : true,
        };
      }));
      return;
    }
    if (msg.type === 'session.complete' && msg.turn_id) {
      setAgent((prev) => prev.map((c) => {
        if (c.agentMemberId !== agentMemberId) return c;
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
      queueMicrotask(() => drainPending(agentMemberId));
      return;
    }
    if (msg.type === 'session.error') {
      patchAgent(agentMemberId, { status: 'error', errorMessage: msg.message ?? 'unknown error', lastActiveAt: now });
      return;
    }
    if (msg.type === 'session.disposed') {
      // Agent finished its work — remove from the panel. UI shows it
      // disappear; user can re-add later.
      setAgent((prev) => prev.filter((c) => c.agentMemberId !== agentMemberId));
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
      // recoverAgentSession does.
      patchAgent(agentMemberId, {
        status: 'reconnecting',
        errorMessage: 'Runtime offline — waiting for daemon to come back',
      });
      recoverAgentSessionRef.current(agentMemberId);
      return;
    }
    if (msg.type === 'daemon_online') {
      // Daemon came back. The current session_id is stale (it was
      // bound to the previous daemon instance which spawned an ACP
      // subprocess that's now gone). Trigger session recovery — the
      // 20s slow-poll loop already POSTs /sessions when daemon is up,
      // so a single nudge is enough. Don't preempt with a status set
      // here; recoverAgentSession owns the status transition.
      recoverAgentSessionRef.current(agentMemberId);
      return;
    }
    if (msg.type === 'room.mention' && typeof msg.text === 'string') {
      // Server-side pushRoomMention forwarded a room message that
      // tagged this agent. Format with sender header so the agent has
      // context, then queue. If the agent is idle, drain immediately;
      // otherwise it goes out on the next session.complete.
      const sender = msg.from_kind === 'user' ? `[room from human] ` : `[room from ${msg.from_id ?? 'agent'}] `;
      const body = `${sender}${msg.text}`;
      const target = agentRef.current.find((c) => c.agentMemberId === agentMemberId);
      if (target?.ws && target.ws.readyState === WebSocket.OPEN && target.turnToMsgIdx.size === 0) {
        dispatchPrompt(agentMemberId, body, true);
        return;
      }
      setAgent((prev) => prev.map((c) =>
        c.agentMemberId === agentMemberId
          ? { ...c, pendingPrompts: [...c.pendingPrompts, body], lastActiveAt: now }
          : c,
      ));
      // Defer to next macrotask: setAgent schedules a re-render, but
      // agentRef.current is mutated only on the NEXT render's body.
      // Calling drainPending synchronously (or via microtask — runs
      // before React commits) reads stale agentRef state where
      // pendingPrompts is still empty, drain bails, and the prompt
      // stays queued forever (until the next session.complete, which
      // never comes if the agent is idle). setTimeout(0) gives React
      // a chance to flush the commit phase first.
      setTimeout(() => drainPending(agentMemberId), 0);
      return;
    }
  }, [focusedAgentId, patchAgent, drainPending, dispatchPrompt]);

  /**
   * Open (or re-open) the WS stream for an existing agent + session id.
   * Extracted so both initial connect (from addAgent) and reconnect /
   * retry paths share the same lifecycle wiring. On unexpected close,
   * schedules an exponential-backoff reconnect up to MAX_RECONNECT_ATTEMPTS;
   * after that the agent lands in `disconnected` with a Retry button on
   * the AgentView header.
   */
  const openAgentWs = useCallback((agentMemberId: string, sessionId: string) => {
    const ws = new WebSocket(
      runtimeWebSocketUrl(`${SESSIONS_BASE}/${encodeURIComponent(sessionId)}/_stream`),
    );
    ws.onmessage = (ev) => handleAgentMessage(agentMemberId, ev.data);
    ws.onopen = () => {
      // Reset backoff counter on successful re-attach. Status flips to
      // 'connected' once the server's session.ready event arrives via
      // handleAgentMessage — don't pre-empt that here.
      reconnectAttemptsRef.current.set(agentMemberId, 0);
    };
    ws.onclose = () => {
      // Intentional removal? Don't reconnect.
      if (removingRef.current.has(agentMemberId)) return;
      const attempts = (reconnectAttemptsRef.current.get(agentMemberId) ?? 0) + 1;
      reconnectAttemptsRef.current.set(agentMemberId, attempts);

      if (attempts > MAX_RECONNECT_ATTEMPTS) {
        // Fast retries exhausted. Don't give up — switch to the
        // slow-recovery path: re-POST /sessions for a fresh session id
        // (the original may be dead on the daemon side if the runtime
        // restarted). recoverAgentSession is self-rescheduling: it polls
        // every ~20s until the runtime is back and the create succeeds,
        // at which point it re-opens a WS and resets the counter.
        // pendingPrompts queued during downtime drain automatically on
        // session.complete after recovery — user's @-mention catches up.
        recoverAgentSessionRef.current(agentMemberId);
        return;
      }

      const delay = reconnectDelay(attempts);
      setAgent((prev) => prev.map((c) =>
        c.agentMemberId === agentMemberId
          ? { ...c, ws: null, status: 'reconnecting' as const, errorMessage: `Reconnecting (${attempts}/${MAX_RECONNECT_ATTEMPTS})…` }
          : c,
      ));
      const t = setTimeout(() => {
        reconnectTimersRef.current.delete(agentMemberId);
        if (removingRef.current.has(agentMemberId)) return;
        // Bail if the agent was removed from state between schedule and fire.
        if (!agentRef.current.some((c) => c.agentMemberId === agentMemberId)) return;
        openAgentWs(agentMemberId, sessionId);
      }, delay);
      reconnectTimersRef.current.set(agentMemberId, t);
    };
    patchAgent(agentMemberId, { ws });
  }, [handleAgentMessage, patchAgent]);

  const addAgent = useCallback(async (claim: ClaimedAgent, opts?: { resumeAcpSessionId?: string }) => {
    const agentMemberId = claim.id; // agent_member.id is the in-panel identity
    if (agentRef.current.some((c) => c.agentMemberId === agentMemberId)) {
      // Already in panel — just focus.
      focus(agentMemberId);
      return;
    }

    // Optimistic insert with connecting status; UI shows the avatar
    // immediately so the user sees their click registered. Restore any
    // cached message transcript from a previous tab/session so the panel
    // doesn't read as empty after reload (the WS event stream itself is
    // not server-persisted today; cache is the only continuity).
    const cachedMessages = projectId
      ? loadCachedAgentMessages(projectId, agentMemberId)
      : [];
    setAgent((prev) => [
      ...prev,
      {
        agentMemberId,
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
    setFocusedAgentId(agentMemberId);

    try {
      const res = await fetch(runtimeApiUrl(`${RUNTIMES_PATH}/${claim.runtime_id}/sessions`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agent_member_id: claim.id,
          ...(projectId ? { project_id: projectId } : {}),
          ...(opts?.resumeAcpSessionId ? { resume_session_id: opts.resumeAcpSessionId } : {}),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        patchAgent(agentMemberId, { status: 'error', errorMessage: `session create failed: ${text.slice(0, 200)}` });
        return;
      }
      const json = (await res.json()) as { session_id: string };
      patchAgent(agentMemberId, { sessionId: json.session_id });
      // Clear any stale removal flag from a previous lifecycle so the
      // new connection's onclose path doesn't get short-circuited.
      removingRef.current.delete(agentMemberId);
      reconnectAttemptsRef.current.set(agentMemberId, 0);

      // Replay persisted history BEFORE opening the WS. The server
      // stores every completed turn's event stream in
      // chat_message.events_json (see runtime-room.flushTurnToHistory).
      // Without this fetch, a freshly-opened agent tab only ever sees
      // events that arrive after the WS subscribes.
      //
      // Two persistence layers + one important asymmetry:
      //   • server history is keyed by session_id (one session = one
      //     POST /sessions = new id every invite). Fresh invites have
      //     no history at all.
      //   • localStorage cache (agentMsgCache) is keyed by
      //     (project_id, agent_member_id) and survives across
      //     session_ids. It's the only thing that carries forward
      //     work done in a previous tab/session.
      //
      // Resolution: history WINS when it has content (it's the
      // authoritative record for the live session, including any
      // turns we missed). When history is empty, KEEP the cache —
      // wiping it would erase cross-session memory and the user
      // would see "No messages" every time they re-invite a agent.
      const historyMessages = await fetchSessionHistory(json.session_id, claim.id);
      if (historyMessages !== null && historyMessages.length > 0) {
        patchAgent(agentMemberId, { messages: historyMessages });
      }

      openAgentWs(agentMemberId, json.session_id);
    } catch (e) {
      patchAgent(agentMemberId, {
        status: 'error',
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }
  }, [projectId, focus, patchAgent, openAgentWs]);

  const removeAgent = useCallback((agentMemberId: string) => {
    // Set BEFORE closing the WS so the close handler sees the flag and
    // skips the reconnect path.
    removingRef.current.add(agentMemberId);
    const pending = reconnectTimersRef.current.get(agentMemberId);
    if (pending) {
      clearTimeout(pending);
      reconnectTimersRef.current.delete(agentMemberId);
    }
    reconnectAttemptsRef.current.delete(agentMemberId);
    // User explicitly removed this agent → drop the cached transcript so
    // reinviting later starts fresh. Project-change tear-down keeps the
    // cache (you might come back to the project and want history).
    if (projectId) clearCachedAgentMessages(projectId, agentMemberId);
    lastPersistedRef.current.delete(agentMemberId);
    setAgent((prev) => {
      const target = prev.find((c) => c.agentMemberId === agentMemberId);
      if (target?.ws && target.ws.readyState === WebSocket.OPEN) {
        try { target.ws.send(JSON.stringify({ type: 'dispose' })); } catch { /* */ }
        try { target.ws.close(); } catch { /* */ }
      }
      const next = prev.filter((c) => c.agentMemberId !== agentMemberId);
      return next;
    });
    setFocusedAgentId((cur) => {
      if (cur !== agentMemberId) return cur;
      const next = agentRef.current.find((c) => c.agentMemberId !== agentMemberId);
      return next?.agentMemberId ?? null;
    });
  }, [projectId]);

  /** User-triggered reconnect for an errored / disconnected agent. Cancels
   *  any pending backoff timer and immediately opens a fresh WS to the
   *  existing session id. If the session id is missing (we never got past
   *  POST /sessions), there's nothing to retry — caller should removeAgent
   *  + re-add instead. */
  const retryAgent = useCallback((agentMemberId: string) => {
    const target = agentRef.current.find((c) => c.agentMemberId === agentMemberId);
    if (!target || !target.sessionId) return;
    const pending = reconnectTimersRef.current.get(agentMemberId);
    if (pending) {
      clearTimeout(pending);
      reconnectTimersRef.current.delete(agentMemberId);
    }
    reconnectAttemptsRef.current.set(agentMemberId, 0);
    patchAgent(agentMemberId, { status: 'connecting', errorMessage: null });
    openAgentWs(agentMemberId, target.sessionId);
  }, [openAgentWs, patchAgent]);

  /**
   * Slow-recovery loop. Triggered after the WS reconnect ladder is
   * exhausted (5 quick attempts) — at that point the original session
   * id is almost certainly dead on the daemon side (it restarted, lost
   * in-memory ACP state). Rather than make the user uninvite + reinvite
   * (which would wipe localStorage history for this agent), we just
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
   * Cancellation: removeAgent sets removingRef, which the in-flight and
   * scheduled retries both check before doing anything.
   */
  const recoverAgentSession = useCallback((agentMemberId: string) => {
    if (removingRef.current.has(agentMemberId)) return;
    const target = agentRef.current.find((c) => c.agentMemberId === agentMemberId);
    if (!target) return;

    // Cancel any pending fast-retry timer; we own the schedule now.
    const pending = reconnectTimersRef.current.get(agentMemberId);
    if (pending) {
      clearTimeout(pending);
      reconnectTimersRef.current.delete(agentMemberId);
    }

    const tryOnce = async () => {
      if (removingRef.current.has(agentMemberId)) return;
      if (!agentRef.current.some((c) => c.agentMemberId === agentMemberId)) return;
      patchAgent(agentMemberId, {
        status: 'reconnecting',
        errorMessage: 'Restoring session — waiting for runtime…',
        ws: null,
      });
      try {
        const res = await fetch(runtimeApiUrl(`${RUNTIMES_PATH}/${target.runtimeId}/sessions`), {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            agent_member_id: agentMemberId,
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
        patchAgent(agentMemberId, { sessionId: json.session_id });
        reconnectAttemptsRef.current.set(agentMemberId, 0);
        openAgentWs(agentMemberId, json.session_id);
        // Successful — don't schedule another attempt. If this WS
        // drops again, the normal onclose ladder will run from scratch.
      } catch {
        if (removingRef.current.has(agentMemberId)) return;
        const t = setTimeout(() => {
          reconnectTimersRef.current.delete(agentMemberId);
          void tryOnce();
        }, 20_000);
        reconnectTimersRef.current.set(agentMemberId, t);
      }
    };

    void tryOnce();
  }, [projectId, openAgentWs, patchAgent]);

  // Keep the forward-declared ref in sync with the live function so
  // openAgentWs's onclose handler can reach it without a circular dep.
  recoverAgentSessionRef.current = recoverAgentSession;

  const sendToFocused = useCallback((text: string) => {
    if (!focusedAgentId) return;
    dispatchPrompt(focusedAgentId, text, true);
  }, [focusedAgentId, dispatchPrompt]);

  const cancelFocused = useCallback(() => {
    if (!focusedAgentId) return;
    const target = agentRef.current.find((c) => c.agentMemberId === focusedAgentId);
    if (!target?.ws || target.ws.readyState !== WebSocket.OPEN) return;
    for (const turnId of target.turnToMsgIdx.keys()) {
      target.ws.send(JSON.stringify({ type: 'cancel', turn_id: turnId }));
    }
  }, [focusedAgentId]);

  const shutdown = useCallback(() => {
    setAgent((prev) => {
      for (const c of prev) {
        if (c.ws && c.ws.readyState === WebSocket.OPEN) {
          try { c.ws.send(JSON.stringify({ type: 'dispose' })); } catch { /* */ }
          try { c.ws.close(); } catch { /* */ }
        }
      }
      return [];
    });
    setFocusedAgentId(null);
  }, []);

  const focusedAgent = focusedAgentId
    ? agent.find((c) => c.agentMemberId === focusedAgentId) ?? null
    : null;

  // Strip internal-only fields from the public agent array. (pendingPrompts
  // intentionally exposed — UI wants to show "N pending" indicator.)
  const publicAgent: AgentSession[] = agent.map(({ ws: _ws, turnToMsgIdx: _t, ...rest }) => {
    void _ws; void _t; return rest;
  });

  return {
    agent: publicAgent,
    focusedAgentId,
    focusedAgent: focusedAgent && (() => {
      const { ws: _ws, turnToMsgIdx: _t, ...rest } = focusedAgent;
      void _ws; void _t; return rest;
    })(),
    messages: focusedAgent?.messages ?? [],
    isProcessing:
      focusedAgent?.status === 'sending' ||
      focusedAgent?.status === 'streaming' ||
      focusedAgent?.status === 'connecting',
    addAgent,
    focus,
    removeAgent,
    retryAgent,
    sendToFocused,
    cancelFocused,
    shutdown,
  };
}
