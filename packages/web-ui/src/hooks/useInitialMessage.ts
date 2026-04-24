
import { useRef, useEffect } from 'react';

/**
 * Sends an initial message once the chat adapter is connected to the correct session.
 *
 * Gates on: connected (WebSocket open) + threadId matches (adapter reconnected to new DO).
 * hasSentRef prevents duplicate sends.
 */
export function useInitialMessage(
  initialMessage: string | null,
  targetThreadId: string,
  sendMessage: (text: string) => void,
  connected: boolean,
  clearInitialMessage: () => void,
) {
  const hasSentRef = useRef(false);

  // Reset when a new initial message is queued
  useEffect(() => {
    if (initialMessage) {
      hasSentRef.current = false;
    }
  }, [initialMessage]);

  useEffect(() => {
    if (!initialMessage || !targetThreadId || !connected || hasSentRef.current) return;

    hasSentRef.current = true;
    clearInitialMessage();
    sendMessage(initialMessage);
  }, [initialMessage, targetThreadId, connected, sendMessage, clearInitialMessage]);
}
