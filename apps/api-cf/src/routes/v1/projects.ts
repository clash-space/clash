import { Hono } from "hono";
import type { Env } from "../../config";

export const projectRoutes = new Hono<{ Bindings: Env }>();

/**
 * Extract user ID from x-user-id header (set by auth-gateway).
 */
function getUserId(c: { req: { header: (name: string) => string | undefined } }): string {
  const userId = c.req.header("x-user-id");
  if (!userId) throw new Error("Missing x-user-id header");
  return userId;
}

// GET /api/v1/projects — List user's projects
projectRoutes.get("/", async (c) => {
  const userId = getUserId(c);

  const { results } = await c.env.DB.prepare(
    "SELECT id, name, description, created_at, updated_at FROM project WHERE owner_id = ? ORDER BY created_at DESC LIMIT 50"
  )
    .bind(userId)
    .all();

  return c.json({ projects: results ?? [] });
});

// POST /api/v1/projects — Create a project
projectRoutes.post("/", async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{ name: string; description?: string }>();

  if (!body.name?.trim()) {
    return c.json({ error: "name is required" }, 400);
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO project (id, owner_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, strftime('%s','now'), strftime('%s','now'))"
  )
    .bind(id, userId, body.name.trim(), body.description?.trim() ?? null)
    .run();

  return c.json({ id, name: body.name.trim(), description: body.description?.trim() ?? null }, 201);
});

// GET /api/v1/projects/:id — Get project details
projectRoutes.get("/:id", async (c) => {
  const userId = getUserId(c);
  const projectId = c.req.param("id");

  const { results } = await c.env.DB.prepare(
    "SELECT id, name, description, created_at, updated_at FROM project WHERE id = ? AND owner_id = ? LIMIT 1"
  )
    .bind(projectId, userId)
    .all();

  if (!results?.length) {
    return c.json({ error: "Project not found" }, 404);
  }

  return c.json(results[0]);
});

// DELETE /api/v1/projects/:id — Delete a project
projectRoutes.delete("/:id", async (c) => {
  const userId = getUserId(c);
  const projectId = c.req.param("id");

  const { results } = await c.env.DB.prepare(
    "SELECT id FROM project WHERE id = ? AND owner_id = ? LIMIT 1"
  )
    .bind(projectId, userId)
    .all();

  if (!results?.length) {
    return c.json({ error: "Project not found" }, 404);
  }

  await c.env.DB.prepare("DELETE FROM project WHERE id = ? AND owner_id = ?")
    .bind(projectId, userId)
    .run();

  return c.json({ deleted: true });
});

// ─── Project room (group-chat IM layer) ──────────────────────────
//
// Multi-user, multi-agent speech-act log. Agents broadcast via the
// say_to_room tool (HTTP POST here); humans type into the room input
// (same POST). Agent internal activity (tool calls, streaming text)
// stays in chat_message — it does NOT come through here.
//
// Mention dispatch: each mention with an agent_member_id → look up the
// active runtime_session for that agent member → push room.mention via
// RuntimeRoom DO RPC. Best-effort: if no live session, the mention is
// silently dropped (the room message itself is still visible — the
// agent just won't auto-respond until next time it's spawned).

interface RoomMention {
  user_id?: string;
  agent_member_id?: string;
}

function normalizeRoomMentions(value: unknown): RoomMention[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): RoomMention[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const userId = typeof row.user_id === "string" ? row.user_id.trim() : "";
    const agentMemberId = typeof row.agent_member_id === "string" ? row.agent_member_id.trim() : "";
    if (!userId && !agentMemberId) return [];
    return [{
      ...(userId ? { user_id: userId } : {}),
      ...(agentMemberId ? { agent_member_id: agentMemberId } : {}),
    }];
  });
}

function parseRoomMentionsJson(value: string): RoomMention[] {
  try {
    return normalizeRoomMentions(JSON.parse(value));
  } catch {
    return [];
  }
}

function roomMentionKey(mention: RoomMention): string {
  return JSON.stringify({
    agent_member_id: mention.agent_member_id ?? "",
    user_id: mention.user_id ?? "",
  });
}

function roomMentionsContentKey(mentions: RoomMention[]): string {
  return JSON.stringify(mentions.map(roomMentionKey).sort());
}

function roomMessageCreateMatchesExisting(
  existing: {
    sender_kind: string;
    sender_id: string;
    sender_user_id: string;
    mentions_json: string;
    text: string;
  },
  incoming: {
    sender_kind: "user" | "agent";
    sender_id: string;
    sender_user_id: string;
    mentions: RoomMention[];
    text: string;
  },
): boolean {
  return existing.sender_kind === incoming.sender_kind &&
    existing.sender_id === incoming.sender_id &&
    existing.sender_user_id === incoming.sender_user_id &&
    existing.text === incoming.text &&
    roomMentionsContentKey(parseRoomMentionsJson(existing.mentions_json)) ===
      roomMentionsContentKey(incoming.mentions);
}

// Membership check — for v1, "in the project" means owner. When
// project_member lands, change this single function and the rest of
// the room layer is unchanged.
async function userInProject(
  env: Env,
  userId: string,
  projectId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT 1 FROM project WHERE id = ? AND owner_id = ?",
  ).bind(projectId, userId).first();
  return !!row;
}

// GET /api/v1/projects/:pid/room/messages — most recent first, paginated by `before`
projectRoutes.get("/:pid/room/messages", async (c) => {
  const userId = getUserId(c);
  const projectId = c.req.param("pid");
  if (!(await userInProject(c.env, userId, projectId))) {
    return c.json({ error: "not found" }, 404);
  }

  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const before = c.req.query("before");

  const stmt = before
    ? c.env.DB.prepare(
        `WITH cursor AS (
           SELECT created_at, id FROM room_message WHERE id = ? AND project_id = ?
         )
         SELECT room_message.id, sender_kind, sender_id, sender_user_id, mentions_json, text, room_message.created_at
           FROM room_message, cursor
          WHERE project_id = ?
            AND (
              room_message.created_at < cursor.created_at
              OR (room_message.created_at = cursor.created_at AND room_message.id < cursor.id)
            )
          ORDER BY room_message.created_at DESC, room_message.id DESC LIMIT ?`,
      ).bind(before, projectId, projectId, limit)
    : c.env.DB.prepare(
        `SELECT id, sender_kind, sender_id, sender_user_id, mentions_json, text, created_at
         FROM room_message WHERE project_id = ?
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      ).bind(projectId, limit);

  const { results } = await stmt.all<{
    id: string;
    sender_kind: string;
    sender_id: string;
    sender_user_id: string;
    mentions_json: string;
    text: string;
    created_at: number;
  }>();

  return c.json({
    messages: (results ?? []).map((r) => ({
      id: r.id,
      sender_kind: r.sender_kind,
      sender_id: r.sender_id,
      sender_user_id: r.sender_user_id,
      mentions: JSON.parse(r.mentions_json) as RoomMention[],
      text: r.text,
      at: r.created_at,
    })),
  });
});

// POST /api/v1/projects/:pid/room/messages — write + broadcast + mention-dispatch
projectRoutes.post("/:pid/room/messages", async (c) => {
  const userId = getUserId(c);
  const projectId = c.req.param("pid");
  if (!(await userInProject(c.env, userId, projectId))) {
    return c.json({ error: "not found" }, 404);
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    id?: string;
    text?: string;
    mentions?: RoomMention[];
    /** Required when sender is an agent (called by say_to_room tool). */
    sender_kind?: "user" | "agent";
    sender_id?: string;
  };

  const text = body.text?.trim();
  if (!text) return c.json({ error: "text required" }, 400);

  const senderKind = body.sender_kind === "agent" ? "agent" : "user";
  const senderId =
    senderKind === "agent"
      ? (body.sender_id?.trim() ?? "")
      : userId;
  if (senderKind === "agent" && !senderId) {
    return c.json({ error: "sender_id required for agent sender" }, 400);
  }

  // Agent sender hardening: prevent an API-key holder from spoofing
  // someone else's agent. sender_id MUST be an agent_member.id owned by
  // the calling user. Without this check, alice's token could write a
  // room message claiming to be bob's Director.
  if (senderKind === "agent") {
    const owns = await c.env.DB.prepare(
      "SELECT id FROM agent_member WHERE id = ? AND user_id = ?",
    ).bind(senderId, userId).first<{ id: string }>();
    if (!owns) {
      return c.json({ error: "sender_id is not an agent_member you own" }, 403);
    }
  }

  const mentions = normalizeRoomMentions(body.mentions);

  const clientId = typeof body.id === "string" ? body.id.trim() : "";
  const id = clientId || crypto.randomUUID();
  const at = Math.floor(Date.now() / 1000);
  const mentionsJson = JSON.stringify(mentions);

  const existing = await c.env.DB.prepare(
    `SELECT id, project_id, sender_kind, sender_id, sender_user_id, mentions_json, text, created_at
       FROM room_message WHERE id = ?`,
  ).bind(id).first<{
    id: string;
    project_id: string;
    sender_kind: string;
    sender_id: string;
    sender_user_id: string;
    mentions_json: string;
    text: string;
    created_at: number;
  }>();
  if (existing) {
    if (existing.project_id !== projectId) {
      return c.json({ error: "room message id already exists" }, 409);
    }
    const existingMentions = parseRoomMentionsJson(existing.mentions_json);
    if (!roomMessageCreateMatchesExisting(existing, {
      sender_kind: senderKind,
      sender_id: senderId,
      sender_user_id: userId,
      mentions,
      text,
    })) {
      return c.json({ error: "room message id already exists with different content" }, 409);
    }
    return c.json({
      id: existing.id,
      project_id: existing.project_id,
      sender_kind: existing.sender_kind,
      sender_id: existing.sender_id,
      sender_user_id: existing.sender_user_id,
      mentions: existingMentions,
      text: existing.text,
      at: existing.created_at,
    });
  }

  await c.env.DB.prepare(
    `INSERT INTO room_message
     (id, project_id, sender_kind, sender_id, sender_user_id, mentions_json, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, projectId, senderKind, senderId, userId, mentionsJson, text, at).run();

  const payload = {
    id,
    project_id: projectId,
    sender_kind: senderKind,
    sender_id: senderId,
    sender_user_id: userId,
    mentions,
    text,
    at,
  };

  // Live broadcast to every browser attached to the project's ProjectRoom.
  const projectStub = c.env.ROOM.get(c.env.ROOM.idFromName(projectId));
  await (projectStub as unknown as {
    broadcastRoomMessage(p: Record<string, unknown>): Promise<void>;
  }).broadcastRoomMessage(payload).catch(() => undefined);

  // Mention dispatch: best-effort. For each mention, find the target
  // user's most-recently-active runtime_session for that agent, and push
  // a room.mention frame to that session's RuntimeRoom DO. The browser
  // AgentSession decides what to do with it (queue as next-turn prompt).
  //
  // NOTE: runtime_session.cwd is currently overloaded to hold project_id
  // (existing hack — see runtimes.ts:267). Filtering by it here scopes
  // the mention to the right project. If the cwd column gets a real
  // dedicated project_id column later, swap the predicate.
  for (const m of mentions) {
    let target: { id: string; runtime_id: string } | null = null;
    if (!m.agent_member_id) continue;
    target = await c.env.DB.prepare(
      `SELECT id, runtime_id FROM runtime_session
       WHERE agent_member_id = ? AND status = 'active' AND cwd = ?
       ORDER BY last_active_at DESC LIMIT 1`,
    ).bind(m.agent_member_id, projectId).first<{ id: string; runtime_id: string }>();
    if (!target) continue;
    const runtimeStub = c.env.RUNTIME_ROOM.get(c.env.RUNTIME_ROOM.idFromName(target.runtime_id));
    void (runtimeStub as unknown as {
      pushRoomMention(sid: string, mention: Record<string, unknown>): Promise<void>;
    }).pushRoomMention(target.id, {
      message_id: id,
      from_kind: senderKind,
      from_id: senderId,
      from_user_id: userId,
      text,
    }).catch(() => undefined);
  }

  return c.json(payload, 201);
});
