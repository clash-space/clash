import { useCallback, useEffect, useRef, useState } from 'react';
import { appendAcpEvent, type ByoMessage, type AvailableCommand } from '@clash/web-ui/lib/acpEvents';

/**
 * useClashRuntime — chat through a registered local-runtime daemon.
 *
 * Sister to useAgentByoBridge (one-shot pair-token flow). This hook drives
 * the persistent-daemon path: list runtimes the user has registered →
 * pick one → POST /api/v1/runtimes/:rid/sessions → open WS to
 * /api/v1/local-sessions/:sid/_stream → relay prompts ↔ events.
 *
 * Same `ByoMessage[]` output shape so ChatbotCopilot's existing list
 * renderer works without changes.
 *
 * v1 scope:
 *   - One active session at a time. Switching runtime disposes the old
 *     session.
 *   - Single agent per runtime (whichever the user picks; for now we just
 *     hardcode claude-code-acp because that's what the daemon detects).
 *   - No reconnect of the WS — drop = "disconnected", user re-selects
 *     the runtime to retry.
 *   - No history / resume — every selection creates a fresh session.
 */

export type RuntimeStatus = 'online' | 'offline';

export interface RuntimeAgent {
  id: string;
  binary?: string;
  version?: string;
}

export interface Runtime {
  id: string;
  machine_id: string;
  hostname: string;
  os: string;
  agents: RuntimeAgent[];
  version: string;
  status: RuntimeStatus;
  last_heartbeat: number | null;
  created_at: number;
}

export type ClashRuntimeStatus =
  | 'idle'              // no runtime selected
  | 'connecting'        // POST /sessions in flight or waiting for session.ready
  | 'connected'         // session.ready received
  | 'sending'           // user prompt in flight
  | 'streaming'         // events arriving
  | 'disconnected'      // WS dropped or daemon went offline
  | 'error';

export interface UseClashRuntimeReturn {
  /** All runtimes the user has registered (any status). */
  runtimes: Runtime[];
  /** id of the runtime the user picked, or null = none / cloud. */
  selectedRuntimeId: string | null;
  /** id of the currently-open session (one at a time in v1). */
  sessionId: string | null;
  status: ClashRuntimeStatus;
  errorMessage: string | null;
  messages: ByoMessage[];
  /** Slash commands the agent currently advertises (replaced per
   *  available_commands_update event). UI uses this for the `/` picker. */
  availableCommands: AvailableCommand[];
  /** True iff status === connected/sending/streaming. */
  ready: boolean;
  /** Re-fetch the runtime list. Cheap; safe to call from a settings page. */
  refresh: () => Promise<void>;
  /** Pick a runtime. Disposes any existing session and starts a fresh one. */
  select: (runtimeId: string | null) => Promise<void>;
  sendMessage: (text: string) => void;
  cancel: () => void;
  shutdown: () => void;
}

const RUNTIMES_PATH = '/api/v1/runtimes';
const SESSIONS_BASE = '/api/v1/local-sessions';

interface CreateSessionResponse {
  session_id: string;
}

export function useClashRuntime(): UseClashRuntimeReturn {
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<ClashRuntimeStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [messages, setMessages] = useState<ByoMessage[]>([]);
  const [availableCommands, setAvailableCommands] = useState<AvailableCommand[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const turnSeq = useRef(0);
  const turnToMsgIdx = useRef(new Map<string, number>());

  const ready = status === 'connected' || status === 'sending' || status === 'streaming';

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(RUNTIMES_PATH, { credentials: 'same-origin' });
      if (!res.ok) {
        // Don't error-state the whole hook just because the list call
        // failed — chat panel still works in cloud mode.
        return;
      }
      const json = (await res.json()) as { runtimes: Runtime[] };
      setRuntimes(json.runtimes ?? []);
    } catch {
      /* network noise; user can refresh manually */
    }
  }, []);

  // Initial fetch on mount.
  useEffect(() => { void refresh(); }, [refresh]);

  // Tear down on unmount so the WS doesn't leak across page changes.
  useEffect(() => {
    return () => {
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
  }, []);

  const handleAcpEvent = useCallback((turnId: string, event: unknown) => {
    setMessages((prev) => {
      const messages = prev.slice();
      const knownIdx = turnToMsgIdx.current.get(turnId);
      const result = appendAcpEvent(messages, turnId, knownIdx, event);
      if (knownIdx === undefined && result.idx >= 0) turnToMsgIdx.current.set(turnId, result.idx);
      if (result.commands) setAvailableCommands(result.commands);
      return messages;
    });
  }, []);

  const onWsMessage = useCallback((data: unknown) => {
    let msg: { type: string; session_id?: string; turn_id?: string; event?: unknown; message?: string; daemon_online?: boolean };
    try { msg = JSON.parse(typeof data === 'string' ? data : ''); }
    catch { return; }

    switch (msg.type) {
      case 'attached':
        // Daemon may or may not be online at this moment — we already
        // gated on `runtime.status === 'online'` before POSTing /sessions,
        // so don't re-surface here.
        return;
      case 'session.ready':
        setStatus('connected');
        return;
      case 'session.event':
        if (msg.turn_id) handleAcpEvent(msg.turn_id, msg.event);
        setStatus('streaming');
        return;
      case 'session.complete':
        if (msg.turn_id) turnToMsgIdx.current.delete(msg.turn_id);
        if (turnToMsgIdx.current.size === 0) setStatus('connected');
        return;
      case 'session.error':
        setErrorMessage(msg.message ?? 'unknown error');
        setStatus('error');
        return;
      case 'session.disposed':
        setStatus('idle');
        setSessionId(null);
        return;
      case 'daemon_offline':
        setStatus('disconnected');
        setErrorMessage('runtime went offline');
        return;
      case 'daemon_online':
        // No state change — we'd need to re-select to start a new session.
        return;
    }
  }, [handleAcpEvent]);

  const select = useCallback(async (runtimeId: string | null) => {
    // Tear down anything already open.
    try { wsRef.current?.close(); } catch { /* */ }
    wsRef.current = null;
    turnToMsgIdx.current.clear();
    setMessages([]);
    setAvailableCommands([]);
    setErrorMessage(null);
    setSessionId(null);
    setSelectedRuntimeId(runtimeId);
    if (!runtimeId) { setStatus('idle'); return; }

    setStatus('connecting');
    try {
      // Pick the first agent the runtime reports. v1 doesn't expose a
      // chooser; if users have multiple agents installed they'd want a
      // dropdown — defer to slice 3.
      const runtime = runtimes.find((r) => r.id === runtimeId);
      const agentId = runtime?.agents[0]?.id ?? 'claude-code-acp';

      const res = await fetch(`${RUNTIMES_PATH}/${runtimeId}/sessions`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId }),
      });
      if (!res.ok) {
        const text = await res.text();
        setErrorMessage(`session create failed: ${text.slice(0, 200)}`);
        setStatus('error');
        return;
      }
      const json = (await res.json()) as CreateSessionResponse;
      setSessionId(json.session_id);

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(
        `${proto}//${window.location.host}${SESSIONS_BASE}/${encodeURIComponent(json.session_id)}/_stream`,
      );
      wsRef.current = ws;
      ws.onmessage = (ev) => onWsMessage(ev.data);
      ws.onclose = () => {
        wsRef.current = null;
        // session.disposed handler already moves to idle if it ran;
        // reaching here without that means the WS was killed mid-flight.
        setStatus((s) => (s === 'idle' ? s : 'disconnected'));
      };
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, [runtimes, onWsMessage]);

  const sendMessage = useCallback((text: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setErrorMessage('not connected');
      setStatus('error');
      return;
    }
    const turnId = `t-${++turnSeq.current}-${Date.now().toString(36)}`;
    setMessages((prev) => [...prev, { id: `user-${turnId}`, role: 'user', parts: [{ type: 'text', text }] }]);
    setStatus('sending');
    ws.send(JSON.stringify({ type: 'prompt', turn_id: turnId, text }));
  }, []);

  const cancel = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    for (const turnId of turnToMsgIdx.current.keys()) {
      ws.send(JSON.stringify({ type: 'cancel', turn_id: turnId }));
    }
  }, []);

  const shutdown = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'dispose' }));
    }
    try { ws?.close(); } catch { /* */ }
    wsRef.current = null;
    turnToMsgIdx.current.clear();
    setSessionId(null);
    setSelectedRuntimeId(null);
    setMessages([]);
    setAvailableCommands([]);
    setErrorMessage(null);
    setStatus('idle');
  }, []);

  return {
    runtimes,
    selectedRuntimeId,
    sessionId,
    status,
    errorMessage,
    messages,
    availableCommands,
    ready,
    refresh,
    select,
    sendMessage,
    cancel,
    shutdown,
  };
}
