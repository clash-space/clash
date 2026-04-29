/**
 * useProjectRoom — group-chat IM state for one project.
 *
 * Owns:
 *   - The room message log (initial fetch from /messages, then live
 *     updates piped in via setLiveMessage).
 *   - The send path (POST /api/v1/projects/:pid/room/messages) which
 *     handles both human-typed messages (sender_kind='user', omitted in
 *     body — server uses x-user-id) and crew tool-originated broadcasts
 *     (later, when the say_to_room MCP tool ships).
 *
 * Live broadcast is delivered by useLoroSync via its `onRoomMessage`
 * sideband callback — same WS as Loro CRDT updates. The parent wiring
 * looks like:
 *
 *   const room = useProjectRoom(projectId);
 *   useLoroSync({ ..., onRoomMessage: room.setLiveMessage });
 *
 * History fetch fires once on mount; refetch() can be called manually
 * after a long disconnect / reconnect to backfill anything missed.
 *
 * No coupling to crew sessions — the GroupChat panel composes this hook
 * with useGroupChat to wire @-mention dispatch and inbound room.mention
 * forwarding.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomMessageEvent, RoomMention } from '@clash/shared-types';

const ROOM_BASE = '/api/v1/projects';

export interface UseProjectRoomReturn {
  messages: RoomMessageEvent[];
  loading: boolean;
  error: string | null;
  /** POST a user-typed message. mentions encodes @-targets. */
  send: (text: string, mentions?: RoomMention[]) => Promise<void>;
  /** Forward a server-pushed room.message into the local log. */
  setLiveMessage: (msg: RoomMessageEvent) => void;
  /** Manual backfill (after long disconnect). */
  refetch: () => Promise<void>;
}

export function useProjectRoom(projectId: string | null): UseProjectRoomReturn {
  const [messages, setMessages] = useState<RoomMessageEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seenIds = useRef<Set<string>>(new Set());

  const append = useCallback((batch: RoomMessageEvent[]) => {
    if (batch.length === 0) return;
    setMessages((prev) => {
      const fresh = batch.filter((m) => !seenIds.current.has(m.id));
      for (const m of fresh) seenIds.current.add(m.id);
      if (fresh.length === 0) return prev;
      // Keep stable created_at order. Backfill batches arrive newest-
      // first from the API; live frames arrive one-at-a-time. Concat,
      // then sort by `at` ascending for render.
      return [...prev, ...fresh].sort((a, b) => a.at - b.at);
    });
  }, []);

  const refetch = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${ROOM_BASE}/${projectId}/room/messages`, {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        setError(`fetch failed: ${res.status}`);
        return;
      }
      const json = (await res.json()) as { messages: RoomMessageEvent[] };
      // Normalize: API returns plain objects; tag them with the
      // discriminator so isSidebandMessage-style consumers don't trip.
      const tagged = (json.messages ?? []).map((m) => ({ ...m, type: 'room.message' as const }));
      append(tagged);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId, append]);

  // History fetch on mount / project change. Live updates flow via
  // setLiveMessage from the parent's WS subscription.
  useEffect(() => {
    seenIds.current = new Set();
    setMessages([]);
    if (projectId) void refetch();
  }, [projectId, refetch]);

  const send = useCallback(async (text: string, mentions?: RoomMention[]) => {
    if (!projectId) return;
    const body = JSON.stringify({ text, mentions: mentions ?? [] });
    try {
      const res = await fetch(`${ROOM_BASE}/${projectId}/room/messages`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body,
      });
      if (!res.ok) {
        setError(`send failed: ${res.status}`);
        return;
      }
      // Server broadcasts via ProjectRoom DO; we'll receive our own
      // message back through onRoomMessage. Don't optimistically insert
      // — keeps a single source of truth and avoids dedupe headaches.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  const setLiveMessage = useCallback((msg: RoomMessageEvent) => {
    append([msg]);
  }, [append]);

  return { messages, loading, error, send, setLiveMessage, refetch };
}
