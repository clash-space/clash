/**
 * useProjectRoom — group-chat IM state for one project.
 *
 * Owns:
 *   - The room message log (initial fetch from /messages, then live
 *     updates piped in via setLiveMessage).
 *   - The send path (POST /api/v1/projects/:pid/room/messages) which
 *     handles both human-typed messages (sender_kind='user', omitted in
 *     body — server uses x-user-id) and agent tool-originated broadcasts
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
 * No coupling to agent sessions — the GroupChat panel composes this hook
 * with useGroupChat to wire @-mention dispatch and inbound room.mention
 * forwarding.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomMessageEvent, RoomMention } from '@clash/shared-types';
import { runtimeApiUrl } from '../lib/runtimeConfig';

const ROOM_BASE = '/api/v1/projects';

export type RoomSyncStatus = 'disabled' | 'imported' | 'mirrored' | 'failed';

export interface RoomSyncMeta {
  mode: 'local-only' | 'cloud-sync';
  remote_room: {
    enabled: boolean;
    status: RoomSyncStatus;
    error?: string;
  };
}

export interface UseProjectRoomReturn {
  messages: RoomMessageEvent[];
  loading: boolean;
  error: string | null;
  sync: RoomSyncMeta | null;
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
  const [sync, setSync] = useState<RoomSyncMeta | null>(null);
  const seenIds = useRef<Set<string>>(new Set());

  const append = useCallback((batch: RoomMessageEvent[]) => {
    if (batch.length === 0) return;
    // Dedup + mutate seenIds OUTSIDE the setMessages updater. React
    // StrictMode double-invokes updaters; if we mutate seenIds inside,
    // the first invoke marks every id seen, the second invoke filters
    // them all out, and we commit an empty state — silently losing the
    // entire batch. Pure updater is required for StrictMode safety.
    const fresh = batch.filter((m) => !seenIds.current.has(m.id));
    if (fresh.length === 0) return;
    for (const m of fresh) seenIds.current.add(m.id);
    // Keep stable created_at order. Backfill batches arrive newest-
    // first from the API; live frames arrive one-at-a-time. Concat,
    // then sort by `at` ascending for render.
    setMessages((prev) => [...prev, ...fresh].sort((a, b) => a.at - b.at));
  }, []);

  const refetch = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(runtimeApiUrl(`${ROOM_BASE}/${projectId}/room/messages`), {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        setError(`fetch failed: ${res.status}`);
        return;
      }
      const json = (await res.json()) as { messages: RoomMessageEvent[]; sync?: RoomSyncMeta };
      setSync(json.sync ?? null);
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
    setSync(null);
    if (projectId) void refetch();
  }, [projectId, refetch]);

  const send = useCallback(async (text: string, mentions?: RoomMention[]) => {
    if (!projectId) return;
    const body = JSON.stringify({ text, mentions: mentions ?? [] });
    try {
      const res = await fetch(runtimeApiUrl(`${ROOM_BASE}/${projectId}/room/messages`), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body,
      });
      if (!res.ok) {
        setError(`send failed: ${res.status}`);
        return;
      }
      const json = (await res.json().catch(() => null)) as
        | (Partial<RoomMessageEvent> & { type?: string; sync?: RoomSyncMeta })
        | null;
      if (json?.sync) setSync(json.sync);
      if (
        json &&
        (json?.type === undefined || json.type === 'room.message') &&
        typeof json.id === 'string' &&
        typeof json.project_id === 'string' &&
        (json.sender_kind === 'user' || json.sender_kind === 'agent') &&
        typeof json.sender_id === 'string' &&
        typeof json.sender_user_id === 'string' &&
        Array.isArray(json.mentions) &&
        typeof json.text === 'string' &&
        typeof json.at === 'number'
      ) {
        append([{ ...(json as RoomMessageEvent), type: 'room.message' }]);
      }
      // Cloud rooms usually echo through ProjectRoom; local daemon rooms
      // return the authoritative message directly. Append it here and let
      // seenIds dedupe any later live echo.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId, append]);

  const setLiveMessage = useCallback((msg: RoomMessageEvent) => {
    append([msg]);
  }, [append]);

  return { messages, loading, error, sync, send, setLiveMessage, refetch };
}
