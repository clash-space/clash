import { useCallback, useEffect, useRef, useState } from 'react';

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
  | 'connected'         // bridge attached + ready
  | 'sending'           // user prompt in flight
  | 'streaming'         // receiving events from bridge
  | 'disconnected'      // bridge dropped or WS closed
  | 'error';

export interface ByoMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_call'; name: string; input?: unknown; output?: unknown }
    | { type: 'raw_event'; event: unknown }
  >;
}

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
}

interface PairResponse {
  token: string;
  display: string;
}

export function useAgentByoBridge() {
  const [state, setState] = useState<ByoBridgeState>({
    pairToken: null,
    pairTokenDisplay: null,
    status: 'idle',
    errorMessage: null,
    messages: [],
    ready: false,
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
  const startPairing = useCallback(async (): Promise<{ token: string; display: string } | null> => {
    updateStatus('pairing');
    try {
      const res = await fetch(PAIR_PATH, { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) {
        updateStatus('error', `pair failed: HTTP ${res.status}`);
        return null;
      }
      const json = (await res.json()) as PairResponse;
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

  /** Step 2: open the browser-side WS to the relay DO. */
  const openBrowserSocket = useCallback((token: string) => {
    // Close any prior socket to avoid two-bridge confusion.
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* already closing */ }
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}${WS_PATH}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      updateStatus('awaiting_bridge');
    };
    ws.onerror = () => {
      // onerror gives no useful info in browsers; the close event right
      // after has the actionable code/reason. Defer message to onclose.
    };
    ws.onclose = (ev) => {
      wsRef.current = null;
      // Any in-flight assistant turn loses its stream — mark them ended.
      turnToMsgIdx.current.clear();
      updateStatus('disconnected', ev.reason || `closed (code ${ev.code})`);
    };
    ws.onmessage = (ev) => onWsMessage(ev.data);
  }, [updateStatus]);

  /**
   * Bridge / DO synthetic / pass-through messages all arrive here.
   * Schema:
   *   { type: "bridge_connected" }                 (DO synthetic)
   *   { type: "bridge_disconnected" }              (DO synthetic)
   *   { type: "ready" }                            (bridge → ready to accept prompts)
   *   { type: "event", id, event }                 (bridge → ACP notification)
   *   { type: "complete", id }                     (bridge → turn finished)
   *   { type: "error", id?, message }              (bridge → error)
   */
  const onWsMessage = useCallback((data: unknown) => {
    let msg: { type: string; id?: string; event?: unknown; message?: string };
    try {
      msg = JSON.parse(typeof data === 'string' ? data : '');
    } catch {
      return;
    }

    if (msg.type === 'bridge_connected') {
      updateStatus('awaiting_bridge'); // stay awaiting until we see "ready"
      return;
    }
    if (msg.type === 'bridge_disconnected') {
      updateStatus('disconnected', 'bridge dropped — re-run `npx @clash-space/bridge` to reconnect');
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
      // If no other turn is in flight, return to connected. Otherwise stay
      // streaming (multi-turn isn't on for v1 but the bookkeeping is cheap).
      if (turnToMsgIdx.current.size === 0) updateStatus('connected');
      return;
    }
    if (msg.type === 'error') {
      updateStatus('error', msg.message ?? 'unknown error');
      return;
    }
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
      const idx = turnToMsgIdx.current.get(turnId);
      const messages = s.messages.slice();
      const ensure = (): number => {
        if (idx !== undefined) return idx;
        const newIdx = messages.length;
        messages.push({
          id: `asst-${turnId}`,
          role: 'assistant',
          parts: [],
        });
        turnToMsgIdx.current.set(turnId, newIdx);
        return newIdx;
      };

      const ev = event as { sessionUpdate?: string; content?: { type?: string; text?: string }; toolCall?: unknown };
      const update = ev?.sessionUpdate;

      if (update === 'agent_message_chunk' || update === 'agent_thought_chunk') {
        const text = ev.content?.text;
        if (typeof text === 'string') {
          const i = ensure();
          const last = messages[i].parts[messages[i].parts.length - 1];
          if (last && last.type === 'text') {
            last.text += text;
          } else {
            messages[i] = {
              ...messages[i],
              parts: [...messages[i].parts, { type: 'text', text }],
            };
          }
          return { ...s, messages, status: 'streaming', ready: true };
        }
      }
      if (update === 'tool_call' && ev.toolCall) {
        const tc = ev.toolCall as { name?: string; input?: unknown; output?: unknown };
        const i = ensure();
        messages[i] = {
          ...messages[i],
          parts: [...messages[i].parts, { type: 'tool_call', name: tc.name ?? 'tool', input: tc.input, output: tc.output }],
        };
        return { ...s, messages };
      }

      // Fallback: keep the raw event so debugging is possible.
      const i = ensure();
      messages[i] = {
        ...messages[i],
        parts: [...messages[i].parts, { type: 'raw_event', event }],
      };
      return { ...s, messages };
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
    sendMessage,
    cancel,
    shutdown,
  };
}
