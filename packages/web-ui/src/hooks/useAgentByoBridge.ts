import { useCallback, useEffect, useRef, useState } from 'react';
import { appendAcpEvent, type ByoMessage as SharedByoMessage, type AvailableCommand } from '@clash/web-ui/lib/acpEvents';
import { runtimeApiUrl, runtimeWebSocketUrl } from '../lib/runtimeConfig';

/**
 * Hook for "Bring Your Own (local) Agent" mode.
 *
 * Sister to useAgentCopilot — same surface (messages / sendMessage / status)
 * so ChatbotCopilot can swap transports cleanly. But the conversation here
 * doesn't go through supervisor / Loro; it relays through the api-cf
 * /agents/byo-bridge/browser endpoint to a clash-bridge process running
 * on the user's machine, which in turn drives a local ACP agent (Claude
 * Code, Codex, etc.).
 *
 * v1 scope (intentionally minimal):
 *   - One pair token, one bridge, one agent.
 *   - BYO thread is fully isolated from cloud thread — no shared messages.
 *   - No persistence of pair token across reloads (re-pair every session).
 *   - No reconnect logic; bridge drop = chat shows "disconnected", user
 *     re-runs `npx clash-bridge`.
 *   - Permission requests + non-text ACP events surface as raw JSON for
 *     now; we shape them once we have a real agent producing them.
 */

const PAIR_PATH = '/agents/byo-bridge/pair';
const WS_PATH = '/agents/byo-bridge/browser';

export type ByoStatus =
  | 'idle'              // not paired
  | 'pairing'           // /pair POST in flight or browser WS opening
  | 'awaiting_bridge'   // browser WS open, waiting for bridge to connect
  | 'awaiting_choice'   // bridge is up, sent us its setup; user must pick agent / session
  | 'starting'          // user picked, waiting for agent spawn
  | 'connected'         // bridge attached + ready
  | 'sending'           // user prompt in flight
  | 'streaming'         // receiving events from bridge
  | 'disconnected'      // bridge dropped or WS closed
  | 'error';

/** @deprecated Replaced by CrewMember in bridge_setup payload. Kept here
 *  so existing imports compile during the rename window. */
export interface BridgeAgent {
  id: string;
  label: string;
  command?: string;
}

/** Crew member shipped in bridge_setup. Matches dist/crew/manifest.json. */
export interface BridgeCrewMember {
  id: string;
  label: string;
  summary?: string;
  agent_id?: string;
}

export interface BridgeSession {
  id: string;       // ACP session id, what the agent's session/load expects
  title: string;    // first user message or summary, for the picker
  cwd: string;      // human-readable cwd from CC's project encoding
  modifiedAt: number; // unix seconds
}

/** Re-exported for callers that imported it from this hook. The canonical
 *  definition is now in lib/acpEvents.ts so the BYO hook and useClashRuntime
 *  share one parser + message shape. */
export type ByoMessage = SharedByoMessage;

export interface ByoBridgeState {
  /** Token issued by /pair, displayed in dialog so user can paste into npx command. */
  pairToken: string | null;
  /** Same token, formatted for human display: "ABCD-EFGH-…". */
  pairTokenDisplay: string | null;
  status: ByoStatus;
  errorMessage: string | null;
  messages: ByoMessage[];
  /** True iff status === connected/sending/streaming. UI uses this to gate input. */
  ready: boolean;
  /** Populated when the bridge sends `bridge_setup`. UI shows a picker. */
  crew: BridgeCrewMember[];
  sessions: BridgeSession[];
  /** Slash commands the agent currently supports (replaced by each
   *  available_commands_update event). UI uses this to power the `/`
   *  picker in the chat input. */
  availableCommands: AvailableCommand[];
}

interface PairResponse {
  token: string;
  display: string;
  /** Server-issued clsh_* token; bridge injects as CLASH_API_KEY in spawn env. */
  agent_api_key?: string;
}

export function useAgentByoBridge() {
  const [state, setState] = useState<ByoBridgeState>({
    pairToken: null,
    pairTokenDisplay: null,
    status: 'idle',
    errorMessage: null,
    messages: [],
    ready: false,
    crew: [],
    sessions: [],
    availableCommands: [],
  });

  const wsRef = useRef<WebSocket | null>(null);
  // Each prompt gets a turnId so we can route incoming events / completes /
  // errors back to the right assistant message bubble. Bumped per send.
  const turnSeq = useRef(0);
  // Map from turnId → assistant message index in state.messages, so streamed
  // events append to the right bubble without an O(N) lookup.
  const turnToMsgIdx = useRef(new Map<string, number>());

  const updateStatus = useCallback((status: ByoStatus, errorMessage: string | null = null) => {
    setState((s) => ({
      ...s,
      status,
      errorMessage,
      ready: status === 'connected' || status === 'sending' || status === 'streaming',
    }));
  }, []);

  /**
   * Step 1: ask api-cf for a pair token. UI then displays the npx command
   * with that token. Step 2 (openWs) needs the token from step 1.
   */
  // API key issued by /pair, forwarded to the bridge in the `start`
  // message so it can spawn the ACP agent with CLASH_API_KEY in env.
  // Stored in a ref (not state) so React re-renders don't accidentally
  // expose it to the DOM.
  const agentApiKey = useRef<string | null>(null);

  const startPairing = useCallback(async (): Promise<{ token: string; display: string } | null> => {
    explicitShutdown.current = false;
    reconnectBackoffMs.current = 1000;
    updateStatus('pairing');
    try {
      const res = await fetch(runtimeApiUrl(PAIR_PATH), { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        updateStatus('error', `pair failed: HTTP ${res.status}`);
        return null;
      }
      const json = (await res.json()) as PairResponse;
      agentApiKey.current = json.agent_api_key ?? null;
      setState((s) => ({ ...s, pairToken: json.token, pairTokenDisplay: json.display }));
      // Open the browser WS immediately — we want to be waiting on the relay
      // before the user has time to run the npx command.
      openBrowserSocket(json.token);
      return json;
    } catch (e) {
      updateStatus('error', `pair failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }, [updateStatus]);

  /** Auto-reconnect backoff state. Reset to base when a WS open succeeds. */
  const reconnectBackoffMs = useRef(1000);
  const explicitShutdown = useRef(false);
  // Forward-decl: openBrowserSocket needs onWsMessage but onWsMessage is
  // defined below it. Ref lets the closure look up the latest value at
  // message arrival time without TDZ tripping useCallback creation.
  const onWsMessageRef = useRef<(data: unknown) => void>(() => undefined);

  /** Step 2: open the browser-side WS to the relay DO. */
  const openBrowserSocket = useCallback((token: string) => {
    // Close any prior socket to avoid two-bridge confusion.
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* already closing */ }
    }
    const url = runtimeWebSocketUrl(`${WS_PATH}?token=${encodeURIComponent(token)}`);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectBackoffMs.current = 1000;
      updateStatus('awaiting_bridge');
    };
    ws.onerror = () => {
      // onerror gives no useful info in browsers; the close event right
      // after has the actionable code/reason. Defer message to onclose.
    };
    ws.onclose = (ev) => {
      wsRef.current = null;
      if (explicitShutdown.current) {
        turnToMsgIdx.current.clear();
        updateStatus('idle');
        return;
      }
      // Auto-reconnect with the same pair token. Bridge keeps the ACP
      // child alive across this gap, so the user resumes the chat
      // without re-pairing. Backoff caps at 30s.
      updateStatus('disconnected', ev.reason || `closed (code ${ev.code}), reconnecting…`);
      const delay = reconnectBackoffMs.current;
      reconnectBackoffMs.current = Math.min(delay * 2, 30_000);
      setTimeout(() => {
        if (explicitShutdown.current) return;
        openBrowserSocket(token);
      }, delay);
    };
    ws.onmessage = (ev) => onWsMessageRef.current(ev.data);
  }, [updateStatus]);

  /**
   * Bridge / DO synthetic / pass-through messages all arrive here.
   * Schema:
   *   { type: "bridge_connected" }                 (DO synthetic)
   *   { type: "bridge_disconnected" }              (DO synthetic)
   *   { type: "bridge_setup", agents, sessions }   (bridge → here are choices)
   *   { type: "ready" }                            (bridge → spawn done)
   *   { type: "event", id, event }                 (bridge → ACP notification)
   *   { type: "complete", id }                     (bridge → turn finished)
   *   { type: "error", id?, message }              (bridge → error)
   */
  const onWsMessage = useCallback((data: unknown) => {
    let msg: {
      type: string;
      id?: string;
      event?: unknown;
      message?: string;
      crew?: BridgeCrewMember[];
      sessions?: BridgeSession[];
    };
    try {
      msg = JSON.parse(typeof data === 'string' ? data : '');
    } catch {
      return;
    }

    if (msg.type === 'bridge_connected') {
      updateStatus('awaiting_bridge'); // wait for either bridge_setup or ready
      return;
    }
    if (msg.type === 'bridge_disconnected') {
      // Don't mark disconnected immediately — bridge may reconnect on its
      // own side. Just go back to awaiting_bridge so the input is gated
      // and the UI can show "reconnecting" if it wants.
      updateStatus('awaiting_bridge', 'bridge dropped — waiting for reconnect');
      return;
    }
    if (msg.type === 'bridge_setup') {
      setState((s) => ({
        ...s,
        crew: msg.crew ?? [],
        sessions: msg.sessions ?? [],
        status: 'awaiting_choice',
        ready: false,
      }));
      return;
    }
    if (msg.type === 'ready') {
      updateStatus('connected');
      return;
    }
    if (msg.type === 'event' && msg.id) {
      handleAcpEvent(msg.id, msg.event);
      return;
    }
    if (msg.type === 'complete' && msg.id) {
      turnToMsgIdx.current.delete(msg.id);
      if (turnToMsgIdx.current.size === 0) updateStatus('connected');
      return;
    }
    if (msg.type === 'error') {
      updateStatus('error', msg.message ?? 'unknown error');
      return;
    }
  }, [updateStatus]);

  // Wire onWsMessage into the ref so openBrowserSocket's WS handler picks
  // up the current closure on every render (in particular: after handleAcpEvent
  // changes when state mutates).
  onWsMessageRef.current = onWsMessage;

  /** Send the bridge a `start` message after the user picks. */
  const startWith = useCallback((crewId: string | null, resumeSessionId?: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    updateStatus('starting');
    ws.send(JSON.stringify({
      type: 'start',
      ...(crewId ? { crew_id: crewId } : {}),
      ...(resumeSessionId ? { resume_session_id: resumeSessionId } : {}),
      // Forward the server-issued API key + URL so the spawned agent's
      // env has CLASH_API_KEY without prompting the user to log in.
      // (api_url tracks the origin so self-hosted deploys work too.)
      ...(agentApiKey.current ? { api_key: agentApiKey.current } : {}),
      api_url: (() => {
        const url = runtimeApiUrl('/');
        if (/^https?:/.test(url)) return url.replace(/\/$/, '');
        return typeof window !== 'undefined'
          ? `${window.location.protocol}//${window.location.host}`
          : undefined;
      })(),
    }));
  }, [updateStatus]);

  /**
   * Append an ACP event to the assistant message for `turnId`. We surface
   * just enough structure for v1: text deltas concatenate; tool_use shows
   * up as a tool_call entry; everything else is shoved into raw_event so
   * we can debug in the UI without losing data.
   *
   * ACP `sessionUpdate` notifications carry a `sessionUpdate` discriminator
   * — common shapes are agent_message_chunk (text delta), tool_call,
   * agent_thought_chunk. We pattern-match best-effort; the SDK's typed
   * schema lets us tighten this later.
   */
  const handleAcpEvent = useCallback((turnId: string, event: unknown) => {
    setState((s) => {
      const messages = s.messages.slice();
      const knownIdx = turnToMsgIdx.current.get(turnId);
      const result = appendAcpEvent(messages, turnId, knownIdx, event);
      if (knownIdx === undefined && result.idx >= 0) turnToMsgIdx.current.set(turnId, result.idx);
      const next: ByoBridgeState = { ...s, messages, status: 'streaming', ready: true };
      if (result.commands) next.availableCommands = result.commands;
      return next;
    });
  }, []);

  const sendMessage = useCallback((text: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      updateStatus('error', 'not connected');
      return;
    }
    const turnId = `t-${++turnSeq.current}-${Date.now().toString(36)}`;
    setState((s) => ({
      ...s,
      messages: [...s.messages, { id: `user-${turnId}`, role: 'user', parts: [{ type: 'text', text }] }],
      status: 'sending',
      ready: true,
    }));
    ws.send(JSON.stringify({ type: 'prompt', id: turnId, text }));
  }, [updateStatus]);

  const cancel = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Cancel every in-flight turn (v1 has at most one but be safe).
    for (const turnId of turnToMsgIdx.current.keys()) {
      ws.send(JSON.stringify({ type: 'cancel', id: turnId }));
    }
  }, []);

  const shutdown = useCallback(() => {
    explicitShutdown.current = true;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'shutdown' }));
    }
    try { ws?.close(); } catch { /* ignore */ }
    wsRef.current = null;
    turnToMsgIdx.current.clear();
    setState({
      pairToken: null,
      pairTokenDisplay: null,
      status: 'idle',
      errorMessage: null,
      messages: [],
      ready: false,
      crew: [],
      sessions: [],
      availableCommands: [],
    });
  }, []);

  // Tear down on unmount so a route change doesn't leak the WS / leave the
  // bridge process holding a dead relay.
  useEffect(() => {
    return () => {
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
  }, []);

  return {
    ...state,
    startPairing,
    /** Tell the bridge to spawn the picked agent (with optional resume id). */
    startWith,
    sendMessage,
    cancel,
    shutdown,
  };
}
