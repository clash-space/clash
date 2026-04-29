/**
 * Collaboration visibility types — presence and activity sideband messages.
 *
 * These are sent as JSON text messages alongside binary Loro CRDT updates
 * over the same WebSocket connection.
 */

// ─── Connection Identity ──────────────────────────────────────

export type ClientType = "browser" | "cli" | "agent";

export interface ClientInfo {
  id: string;
  userId: string;
  clientType: ClientType;
  name: string;
  avatar?: string;
  connectedAt: number;
  /**
   * If set, this client has the timeline editor open on the given node and
   * holds a soft edit-lock. Server-side writers (e.g. agent tools) should
   * refuse to mutate node.data.timelineDsl while the lock is held.
   *
   * Lock is released when:
   *   - client sends `set_editing_node` with nodeId=null (Editor closed)
   *   - WebSocket disconnects (presence is WS-bound)
   *
   * "Soft" because nothing physically prevents a writer that ignores the
   * advertisement; all timelineDsl writers are expected to consult presence.
   */
  editingNodeId?: string | null;
}

// ─── Sideband Message Types ───────────────────────────────────

export interface PresenceClient {
  id: string;
  clientType: ClientType;
  userId: string;
  name: string;
  avatar?: string;
  /** See ClientInfo.editingNodeId. Re-broadcast so all clients know who holds what. */
  editingNodeId?: string | null;
}

/**
 * Client → server: declare or release the soft edit-lock on a node.
 * Sent over the same WebSocket as binary CRDT updates.
 */
export interface SetEditingNodeMessage {
  type: "set_editing_node";
  /** nodeId to start editing, or null to release any held lock. */
  nodeId: string | null;
}

export interface PresenceMessage {
  type: "presence";
  clients: PresenceClient[];
}

export type ActivityAction = "added" | "updated" | "deleted";

export interface ActivityActor {
  clientType: ClientType;
  name: string;
}

export interface ActivityMessage {
  type: "activity";
  actor: ActivityActor;
  action: ActivityAction;
  nodeId: string;
  nodeType: string;
  label: string;
  timestamp: number;
}

// ─── Project Room (group-chat IM) ─────────────────────────────

export interface RoomMention {
  user_id: string;
  crew_id?: string;
}

/** Server → client: a new room message (matches D1 row + mentions parsed). */
export interface RoomMessageEvent {
  type: "room.message";
  id: string;
  project_id: string;
  sender_kind: "user" | "crew";
  sender_id: string;       // crew_id when 'crew', user_id when 'user'
  sender_user_id: string;  // always the human (daemon owner for crew)
  mentions: RoomMention[];
  text: string;
  at: number;              // unix seconds
}

export type SidebandMessage = PresenceMessage | ActivityMessage | RoomMessageEvent;

/**
 * Type guard: check if a parsed JSON message is a valid sideband message.
 */
export function isSidebandMessage(msg: unknown): msg is SidebandMessage {
  if (!msg || typeof msg !== "object") return false;
  const t = (msg as any).type;
  return t === "presence" || t === "activity" || t === "room.message";
}
