'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAgent } from 'agents/react';
import { useAgentChat } from '@cloudflare/ai-chat/react';

// Agent WebSocket goes through Next.js rewrite proxy (same origin).
// No external URL needed — the /agents/* path is proxied to api-cf.
const API_HOST = typeof window !== 'undefined'
  ? window.location.host
  : 'localhost:3000';

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
  const onCustomEventRef = useRef(onCustomEvent);

  useEffect(() => {
    onCustomEventRef.current = onCustomEvent;
  }, [onCustomEvent]);

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
    onOpen: () => setConnected(true),
    onClose: () => setConnected(false),
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

  const chat = useAgentChat({ agent });

  const clearCustomEvents = useCallback(() => {
    setCustomEvents([]);
  }, []);

  return {
    ...chat,
    agent,
    connected,
    customEvents,
    clearCustomEvents,
  };
}
