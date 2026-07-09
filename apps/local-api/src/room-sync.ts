export interface RemoteRoomMention {
  user_id?: string;
  agent_member_id?: string;
}

export interface RemoteRoomMessage {
  id: string;
  project_id: string;
  sender_kind: "user" | "agent";
  sender_id: string;
  sender_user_id: string;
  mentions: RemoteRoomMention[];
  text: string;
  at: number;
}

export interface RemoteRoomMessageInput {
  id: string;
  text: string;
  mentions: RemoteRoomMention[];
  sender_kind: "user" | "agent";
  sender_id: string;
  sender_user_id: string;
}

export interface RemoteRoomSync {
  listMessages(projectId: string): Promise<RemoteRoomMessage[]>;
  postMessage(projectId: string, message: RemoteRoomMessageInput): Promise<void>;
}

export interface RemoteRoomSyncOptions {
  baseUrl: string;
  token?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export interface RoomMirrorConflict {
  id: string;
  reason: "content-mismatch";
  local: RemoteRoomMessage;
  remote: RemoteRoomMessage;
}

export interface RoomMirrorPlan {
  exportToRemote: RemoteRoomMessage[];
  importToLocal: RemoteRoomMessage[];
  conflicts: RoomMirrorConflict[];
  matchedIds: string[];
}

export interface LocalRoomMirrorMention {
  user_id?: string;
  agent_member_id?: string;
}

export interface LocalRoomMirrorMessage {
  id: string;
  project_id: string;
  sender_kind: "user" | "agent";
  sender_id: string;
  sender_user_id: string;
  mentions: LocalRoomMirrorMention[];
  text: string;
  created_at: number;
}

export interface SelectRoomMessagesForMirrorInput {
  projectId: string;
  roomMessages: readonly LocalRoomMirrorMessage[];
  sessionMessages?: readonly unknown[];
}

function endpoint(baseUrl: string, projectId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/v1/projects/${encodeURIComponent(projectId)}/room/messages`;
}

function authHeaders(token: string | undefined, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return headers;
}

function roomMentionKey(mention: RemoteRoomMention): string {
  return JSON.stringify({
    agent_member_id: mention.agent_member_id ?? "",
    user_id: mention.user_id ?? "",
  });
}

function roomMentionsContentKey(mentions: RemoteRoomMention[]): string {
  return JSON.stringify(mentions.map(roomMentionKey).sort());
}

export function roomMessageContentKey(message: RemoteRoomMessage): string {
  return JSON.stringify({
    project_id: message.project_id,
    sender_kind: message.sender_kind,
    sender_id: message.sender_id,
    sender_user_id: message.sender_user_id,
    mentions: roomMentionsContentKey(message.mentions),
    text: message.text,
  });
}

export function selectRoomMessagesForMirror({
  projectId,
  roomMessages,
}: SelectRoomMessagesForMirrorInput): RemoteRoomMessage[] {
  return roomMessages
    .filter((message) => message.project_id === projectId)
    .map((message) => ({
      id: message.id,
      project_id: message.project_id,
      sender_kind: message.sender_kind,
      sender_id: message.sender_id,
      sender_user_id: message.sender_user_id,
      mentions: message.mentions.map((mention) => ({
        ...(mention.user_id ? { user_id: mention.user_id } : {}),
        ...(mention.agent_member_id ? { agent_member_id: mention.agent_member_id } : {}),
      })),
      text: message.text,
      at: message.created_at,
    }));
}

function appendOrder(messages: RemoteRoomMessage[]): RemoteRoomMessage[] {
  return [...messages].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

function roomMessageById(messages: RemoteRoomMessage[]): Map<string, RemoteRoomMessage> {
  const byId = new Map<string, RemoteRoomMessage>();
  for (const message of messages) {
    if (!byId.has(message.id)) byId.set(message.id, message);
  }
  return byId;
}

export function planRoomMirror({
  localMessages,
  remoteMessages,
}: {
  localMessages: RemoteRoomMessage[];
  remoteMessages: RemoteRoomMessage[];
}): RoomMirrorPlan {
  const localById = roomMessageById(localMessages);
  const remoteById = roomMessageById(remoteMessages);
  const conflicts: RoomMirrorConflict[] = [];
  const matchedIds: string[] = [];

  for (const [id, local] of localById) {
    const remote = remoteById.get(id);
    if (!remote) continue;
    if (roomMessageContentKey(local) === roomMessageContentKey(remote)) {
      matchedIds.push(id);
      continue;
    }
    conflicts.push({ id, reason: "content-mismatch", local, remote });
  }

  const conflictIds = new Set(conflicts.map((conflict) => conflict.id));
  const exportToRemote = appendOrder([...localById.values()]).filter((message) =>
    !remoteById.has(message.id) && !conflictIds.has(message.id)
  );
  const importToLocal = appendOrder([...remoteById.values()]).filter((message) =>
    !localById.has(message.id) && !conflictIds.has(message.id)
  );

  return {
    exportToRemote,
    importToLocal,
    conflicts: conflicts.sort((a, b) => a.id.localeCompare(b.id)),
    matchedIds: matchedIds.sort(),
  };
}

async function assertOk(response: Response, operation: string): Promise<void> {
  if (response.ok) return;
  const text = await response.text().catch(() => "");
  throw new Error(`${operation} failed: ${response.status}${text ? ` ${text}` : ""}`);
}

function normalizeRemoteMessage(raw: unknown, projectId: string): RemoteRoomMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.text !== "string" ||
    (row.sender_kind !== "user" && row.sender_kind !== "agent") ||
    typeof row.sender_id !== "string" ||
    typeof row.sender_user_id !== "string" ||
    typeof row.at !== "number"
  ) {
    return null;
  }
  const mentions = Array.isArray(row.mentions)
    ? row.mentions
        .filter((mention): mention is Record<string, unknown> => !!mention && typeof mention === "object")
        .flatMap((mention): RemoteRoomMention[] => {
          const userId = typeof mention.user_id === "string" ? mention.user_id.trim() : "";
          const agentMemberId = typeof mention.agent_member_id === "string" ? mention.agent_member_id.trim() : "";
          if (!userId && !agentMemberId) return [];
          return [{
            ...(userId ? { user_id: userId } : {}),
            ...(agentMemberId ? { agent_member_id: agentMemberId } : {}),
          }];
        })
    : [];
  return {
    id: row.id,
    project_id: typeof row.project_id === "string" ? row.project_id : projectId,
    sender_kind: row.sender_kind,
    sender_id: row.sender_id,
    sender_user_id: row.sender_user_id,
    mentions,
    text: row.text,
    at: row.at,
  };
}

export function createHttpRemoteRoomSync(options: RemoteRoomSyncOptions): RemoteRoomSync {
  const fetchImpl = options.fetch ?? fetch;

  return {
    async listMessages(projectId) {
      const res = await fetchImpl(endpoint(options.baseUrl, projectId), {
        method: "GET",
        headers: authHeaders(options.token),
      });
      await assertOk(res, "remote room list");
      const body = (await res.json().catch(() => ({}))) as { messages?: unknown[] };
      return Array.isArray(body.messages)
        ? body.messages
            .map((message) => normalizeRemoteMessage(message, projectId))
            .filter((message): message is RemoteRoomMessage => !!message)
        : [];
    },

    async postMessage(projectId, message) {
      const headers = authHeaders(options.token, { "content-type": "application/json" });
      const res = await fetchImpl(endpoint(options.baseUrl, projectId), {
        method: "POST",
        headers,
        body: JSON.stringify(message),
      });
      await assertOk(res, "remote room post");
    },
  };
}
