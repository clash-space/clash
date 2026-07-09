/**
 * useProjectRoom — hosted/cloud group-chat IM state for one project.
 *
 * Owns:
 *   - The room message log (initial fetch from /messages, then live
 *     updates piped in via setLiveMessage).
 *   - The hosted send path (POST /api/v1/projects/:pid/room/messages) which
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
 * after a long disconnect / reconnect to backfill anything missed. Local-first
 * v1 intentionally does not expose local room persistence; a 404 from the
 * local runtime means hosted/cloud room is unavailable, not that local room
 * state should be emulated.
 *
 * No coupling to agent sessions — the GroupChat panel composes this hook
 * with useGroupChat to wire @-mention dispatch and inbound room.mention
 * forwarding.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomMessageEvent, RoomMention } from '@clash/shared-types';
import { runtimeApiUrl } from '../lib/runtimeConfig';

const ROOM_BASE = '/api/v1/projects';
const LOCAL_ROOM_UNAVAILABLE = 'Cloud room is unavailable in this local project';

export type RoomSyncStatus = 'disabled' | 'pending' | 'imported' | 'mirrored' | 'failed';

export interface RoomSyncMeta {
  mode: 'local-only' | 'cloud-sync';
  remote_room: {
    enabled: boolean;
    status: RoomSyncStatus;
    error?: string;
  };
  admission?: {
    allowed: boolean;
    reason: 'remote-room-not-configured' | null;
    requirements: string[];
  };
  trace_policy?: {
    schemaVersion: 1;
    room_messages: {
      kind: 'project-chat';
      syncDefault: 'sync-when-project-sync-enabled';
      rawAgentTrace: false;
    };
    agent_session_metadata?: {
      kind: 'public-session-metadata';
      syncDefault: 'sync-when-project-sync-enabled';
      rawAgentTrace: false;
    };
    raw_agent_traces: {
      kind: 'private-runtime-trace';
      syncDefault: 'local-only';
      optInRequiredForSync: true;
      excludedFromRoom: true;
      sensitiveFields?: string[];
      syncAdmission: {
        allowed: false;
        reason: 'explicit-policy-required';
        requirements: string[];
        defaultAllowed: false;
      };
      retention?: {
        default: 'until-session-delete';
        scope: 'per-session';
        api: string;
        cliCommand: string;
        clears: string[];
      };
    };
  };
}

export interface RoomConflictMessage extends RoomMessageEvent {
  project_id: string;
  contentHash: string;
}

export interface RoomSyncPlan {
  exportedIds: string[];
  importedIds: string[];
  matchedIds: string[];
  conflicts: Array<{
    id: string;
    reason: string;
    local: RoomConflictMessage;
    remote: RoomConflictMessage;
  }>;
  resolvedConflictIds?: string[];
}

export interface UseProjectRoomReturn {
  messages: RoomMessageEvent[];
  loading: boolean;
  error: string | null;
  sync: RoomSyncMeta | null;
  syncPlan: RoomSyncPlan | null;
  /** Explicitly mirror local/remote room messages and retain any conflict plan. */
  syncRoom: () => Promise<void>;
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
  const [syncPlan, setSyncPlan] = useState<RoomSyncPlan | null>(null);
  const seenIds = useRef<Set<string>>(new Set());

  const markRoomUnavailable = useCallback(() => {
    setSync({
      mode: 'local-only',
      remote_room: { enabled: false, status: 'disabled' },
      admission: {
        allowed: false,
        reason: null,
        requirements: [],
      },
    });
    setSyncPlan(null);
  }, []);

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
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        messages?: RoomMessageEvent[];
        sync?: RoomSyncMeta;
        plan?: RoomSyncPlan;
      };
      if (res.status === 404) {
        markRoomUnavailable();
        return;
      }
      setSync(json.sync ?? null);
      setSyncPlan(json.plan ?? null);
      if (!res.ok) {
        setError(json.error ?? `fetch failed: ${res.status}`);
        return;
      }
      // Normalize: API returns plain objects; tag them with the
      // discriminator so isSidebandMessage-style consumers don't trip.
      const tagged = (json.messages ?? []).map((m) => ({ ...m, type: 'room.message' as const }));
      append(tagged);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId, append, markRoomUnavailable]);

  // History fetch on mount / project change. Live updates flow via
  // setLiveMessage from the parent's WS subscription.
  useEffect(() => {
    seenIds.current = new Set();
    setMessages([]);
    setSync(null);
    setSyncPlan(null);
    if (projectId) void refetch();
  }, [projectId, refetch]);

  const send = useCallback(async (text: string, mentions?: RoomMention[]) => {
    if (!projectId) return;
    if (sync?.admission?.allowed === false) {
      setError(LOCAL_ROOM_UNAVAILABLE);
      return;
    }
    const body = JSON.stringify({ text, mentions: mentions ?? [] });
    try {
      const res = await fetch(runtimeApiUrl(`${ROOM_BASE}/${projectId}/room/messages`), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body,
      });
      const json = (await res.json().catch(() => null)) as
        | (Partial<RoomMessageEvent> & { type?: string; error?: string; sync?: RoomSyncMeta; plan?: RoomSyncPlan })
        | null;
      if (res.status === 404) {
        markRoomUnavailable();
        setError(LOCAL_ROOM_UNAVAILABLE);
        return;
      }
      if (json?.sync) setSync(json.sync);
      if (json?.plan) setSyncPlan(json.plan);
      if (!res.ok) {
        setError(json?.error ?? `send failed: ${res.status}`);
        return;
      }
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
      // Hosted rooms usually echo through ProjectRoom. Some compatible hosts
      // return the authoritative message directly; append it here and let
      // seenIds dedupe any later live echo.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId, append, markRoomUnavailable, sync?.admission?.allowed]);

  const syncRoom = useCallback(async () => {
    if (!projectId) return;
    if (sync?.admission?.allowed === false) {
      setError(LOCAL_ROOM_UNAVAILABLE);
      return;
    }
    setError(null);
    try {
      const res = await fetch(runtimeApiUrl(`${ROOM_BASE}/${projectId}/room/sync`), {
        method: 'POST',
        credentials: 'same-origin',
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        sync?: RoomSyncMeta;
        plan?: RoomSyncPlan;
      };
      if (res.status === 404) {
        markRoomUnavailable();
        setError(LOCAL_ROOM_UNAVAILABLE);
        return;
      }
      setSync(json.sync ?? null);
      setSyncPlan(json.plan ?? null);
      if (!res.ok) {
        setError(json.error ?? `sync failed: ${res.status}`);
        return;
      }
      await refetch();
      setSync(json.sync ?? null);
      setSyncPlan(json.plan ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId, refetch, markRoomUnavailable, sync?.admission?.allowed]);

  const setLiveMessage = useCallback((msg: RoomMessageEvent) => {
    append([msg]);
  }, [append]);

  return { messages, loading, error, sync, syncPlan, syncRoom, send, setLiveMessage, refetch };
}
