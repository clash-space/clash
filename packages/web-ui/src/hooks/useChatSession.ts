
import { useCallback, useRef } from 'react';
import { useAgentCopilot } from './useAgentCopilot';
import type { CustomEvent } from './useAgentCopilot';

interface UseChatSessionParams {
  projectId: string;
  threadId: string;
  setThreadId: (id: string) => void;
  onSessionCreated?: (newThreadId: string, title: string) => void;
  onCustomEvent?: (data: Record<string, unknown>) => void;
}

/**
 * Main chat session hook.
 * No session (threadId='') → first message creates session, queues message for onOpen.
 * Has session → sends directly via adapter.
 */
export function useChatSession({
  projectId,
  threadId,
  setThreadId,
  onSessionCreated,
  onCustomEvent,
}: UseChatSessionParams) {
  const adapter = useAgentCopilot({
    projectId,
    threadId,
    onCustomEvent,
  });

  const hasSession = !!threadId;
  const messages = hasSession ? adapter.messages : [];
  const isLoading = adapter.status === 'submitted' || adapter.status === 'streaming';

  if (adapter.messages.length > 0 || adapter.status !== 'ready') {
    console.log('[useChatSession]', { tid: threadId?.slice(-6) || '(none)', hasSession, aMsgs: adapter.messages.length, dMsgs: messages.length, status: adapter.status });
  }

  const creatingSessionRef = useRef(false);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    if (!threadId) {
      if (creatingSessionRef.current) return;
      creatingSessionRef.current = true;
      try {
        console.log('[useChatSession] Creating new session...');
        const title = text.slice(0, 40).trim() + (text.length > 40 ? '...' : '');
        const res = await fetch('/api/v1/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, title }),
        });
        if (!res.ok) throw new Error('Failed to create session');
        const data = await res.json();
        console.log('[useChatSession] Session created:', data.threadId);

        // Queue the first message; the adapter flushes it when the new WS
        // to the freshly-created DO reports `connected=true` (via useAgent's
        // onOpen). Queue BEFORE setThreadId so the effect is armed before
        // the reconnect kicks in.
        adapter.queueMessageOnOpen(text);
        setThreadId(data.threadId);
        onSessionCreated?.(data.threadId, title);
      } catch (err) {
        console.error('Failed to create session:', err);
      } finally {
        creatingSessionRef.current = false;
      }
    } else {
      console.log('[useChatSession] Sending to existing session:', threadId.slice(-6));
      adapter.sendMessage({ text });
    }
  }, [threadId, isLoading, projectId, setThreadId, onSessionCreated, adapter]);

  return {
    messages,
    sendMessage,
    stop: adapter.stop,
    status: adapter.status,
    clearHistory: adapter.clearHistory,
    connected: adapter.connected,
    isLoading,
    customEvents: adapter.customEvents,
    clearCustomEvents: adapter.clearCustomEvents,
  };
}
