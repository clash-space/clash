
import { useState, useCallback, useRef, useEffect } from 'react';
import { useAgent } from 'agents/react';
import { useAgentChat } from '@cloudflare/ai-chat/react';

// Agent WebSocket goes through Next.js rewrite proxy (same origin).
// No external URL needed — the /agents/* path is proxied to api-cf.
const API_HOST = typeof window !== 'undefined'
  ? window.location.host
  : 'localhost:3000';

const MAX_RECONNECT_ATTEMPTS = 5;

export interface CustomEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

interface UseAgentCopilotOptions {
  projectId: string;
  threadId: string;
  onCustomEvent?: (data: Record<string, unknown>) => void;
}

export function useAgentCopilot({ projectId, threadId, onCustomEvent }: UseAgentCopilotOptions) {
  const [connected, setConnected] = useState(false);
  const [customEvents, setCustomEvents] = useState<CustomEvent[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const onCustomEventRef = useRef(onCustomEvent);

  useEffect(() => {
    onCustomEventRef.current = onCustomEvent;
  }, [onCustomEvent]);

  // Reset reconnect counter when threadId changes (new session)
  useEffect(() => {
    reconnectAttemptsRef.current = 0;
    setConnectionError(null);
  }, [threadId]);

  const handleCustomEvent = useCallback((data: Record<string, unknown>) => {
    const event: CustomEvent = {
      id: `ce-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: data.type as string,
      data,
      timestamp: Date.now(),
    };
    setCustomEvents(prev => [...prev, event]);
    onCustomEventRef.current?.(data);
  }, []);

  const agent = useAgent({
    agent: 'supervisor',
    name: `${projectId}:${threadId}`,
    host: API_HOST,
    onOpen: () => {
      // console.log('[useAgentCopilot] WS opened');
      setConnected(true);
      setConnectionError(null);
      reconnectAttemptsRef.current = 0;
    },
    onClose: () => {
      // console.log('[useAgentCopilot] WS closed');
      setConnected(false);
      reconnectAttemptsRef.current += 1;
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setConnectionError(`Connection lost after ${MAX_RECONNECT_ATTEMPTS} attempts. Please refresh the page.`);
      }
    },
    onMessage: (event: MessageEvent) => {
      // useAgent passes through messages that don't match cf_agent_* protocol.
      // These are our custom events (node_proposal, rerun_generation, timeline_edit).
      try {
        const data = JSON.parse(event.data);
        if (data.type && !data.type.startsWith('cf_agent_')) {
          handleCustomEvent(data);
        }
      } catch {
        // Not JSON or parse error — ignore
      }
    },
  });

  const chat = useAgentChat({
    agent,
    onError: (error) => {
      console.error('[useAgentCopilot] Chat error:', error);
      setConnectionError(error.message || 'Failed to send message. Please try again.');
    },
  });

  const clearCustomEvents = useCallback(() => {
    setCustomEvents([]);
  }, []);

  const clearConnectionError = useCallback(() => {
    setConnectionError(null);
    setLastFailedMessage(null);
  }, []);

  // --- Queue-on-open ----------------------------------------------------
  // When the caller creates a new session, the WS reconnects to the fresh
  // Durable Object and `connected` transitions false → true. `sendMessage`
  // must not fire until that new WS is open, otherwise it lands on the old
  // thread (or nothing). The caller queues the first message here, and this
  // effect flushes it on the next open transition.
  //
  // Uses the CF Agents SDK's `connected` state (surfaced via our `onOpen`
  // callback above) rather than poking the WebSocket directly — so the
  // semantics follow whatever the SDK considers "open" (including handshake
  // completion).
  const pendingOnOpenRef = useRef<string | null>(null);
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatRef = useRef(chat);
  useEffect(() => { chatRef.current = chat; }, [chat]);

  const queueMessageOnOpen = useCallback((text: string) => {
    pendingOnOpenRef.current = text;
    // Safety: if the WS never opens (server dead, auth rejected, etc.),
    // drop the pending after 10s so it doesn't silently send much later
    // after a manual reconnect.
    if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
    pendingTimeoutRef.current = setTimeout(() => {
      if (pendingOnOpenRef.current) {
        console.warn('[useAgentCopilot] Pending first-message dropped — WS did not open within 10s');
        pendingOnOpenRef.current = null;
      }
      pendingTimeoutRef.current = null;
    }, 10000);
  }, []);

  useEffect(() => {
    if (!connected) return;
    const pending = pendingOnOpenRef.current;
    if (!pending) return;
    pendingOnOpenRef.current = null;
    if (pendingTimeoutRef.current) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
    chatRef.current.sendMessage({ text: pending });
  }, [connected]);

  // Cleanup on unmount so we don't leak the timeout.
  useEffect(() => () => {
    if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
  }, []);

  return {
    ...chat,
    agent,
    connected,
    connectionError,
    lastFailedMessage,
    clearConnectionError,
    customEvents,
    clearCustomEvents,
    queueMessageOnOpen,
  };
}
