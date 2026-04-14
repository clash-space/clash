'use client';

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

  return {
    ...chat,
    agent,
    connected,
    connectionError,
    lastFailedMessage,
    clearConnectionError,
    customEvents,
    clearCustomEvents,
  };
}
