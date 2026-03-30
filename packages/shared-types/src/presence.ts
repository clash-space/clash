/**
 * Collaboration visibility types — presence and activity sideband messages.
 *
 * These are sent as JSON text messages alongside binary Loro CRDT updates
 * over the same WebSocket connection.
 */

// ─── Connection Identity ──────────────────────────────────────

export type ClientType = "browser" | "cli";

export interface ClientInfo {
  id: string;
  userId: string;
  clientType: ClientType;
  name: string;
  avatar?: string;
  connectedAt: number;
}

// ─── Sideband Message Types ───────────────────────────────────

export interface PresenceClient {
  id: string;
  clientType: ClientType;
  userId: string;
  name: string;
  avatar?: string;
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

export type SidebandMessage = PresenceMessage | ActivityMessage;

/**
 * Type guard: check if a parsed JSON message is a valid sideband message.
 */
export function isSidebandMessage(msg: unknown): msg is SidebandMessage {
  if (!msg || typeof msg !== "object") return false;
  const t = (msg as any).type;
  return t === "presence" || t === "activity";
}
