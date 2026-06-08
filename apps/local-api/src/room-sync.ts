export interface RemoteRoomMention {
  user_id: string;
  crew_member_id?: string;
  crew_id?: string;
}

export interface RemoteRoomMessage {
  id: string;
  project_id: string;
  sender_kind: "user" | "crew";
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
  sender_kind: "user" | "crew";
  sender_id: string;
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

function endpoint(baseUrl: string, projectId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/v1/projects/${encodeURIComponent(projectId)}/room/messages`;
}

function authHeaders(token: string | undefined, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return headers;
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
    (row.sender_kind !== "user" && row.sender_kind !== "crew") ||
    typeof row.sender_id !== "string" ||
    typeof row.sender_user_id !== "string" ||
    typeof row.at !== "number"
  ) {
    return null;
  }
  const mentions = Array.isArray(row.mentions)
    ? row.mentions
        .filter((mention): mention is Record<string, unknown> => !!mention && typeof mention === "object")
        .map((mention) => ({
          user_id: typeof mention.user_id === "string" ? mention.user_id : "",
          ...(typeof mention.crew_member_id === "string" ? { crew_member_id: mention.crew_member_id } : {}),
          ...(typeof mention.crew_id === "string" ? { crew_id: mention.crew_id } : {}),
        }))
        .filter((mention) => mention.user_id.length > 0)
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
