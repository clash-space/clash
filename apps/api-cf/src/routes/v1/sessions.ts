import { Hono } from "hono";
import type { Env } from "../../config";

export const sessionRoutes = new Hono<{ Bindings: Env }>();

function getUserId(c: {
  req: { header: (name: string) => string | undefined };
}): string {
  const userId = c.req.header("x-user-id");
  if (!userId) throw new Error("Missing x-user-id header");
  return userId;
}

type SessionRow = {
  id: string;
  thread_id: string;
  project_id: string;
  title: string | null;
  archived_at: number | null;
  created_at: number | null;
  updated_at: number | null;
};

function publicSession(row: SessionRow) {
  const timestamp = (value: number | null) =>
    typeof value === "number"
      ? new Date(value * 1000).toISOString()
      : undefined;
  return {
    id: row.id,
    threadId: row.thread_id,
    projectId: row.project_id,
    title: row.title ?? undefined,
    type: "cloud" as const,
    ...(timestamp(row.archived_at)
      ? { archivedAt: timestamp(row.archived_at) }
      : {}),
    ...(timestamp(row.created_at)
      ? { createdAt: timestamp(row.created_at) }
      : {}),
    ...(timestamp(row.updated_at)
      ? { updatedAt: timestamp(row.updated_at) }
      : {}),
  };
}

// GET /api/v1/sessions?projectId=xxx&archived=active|only|include
sessionRoutes.get("/", async (c) => {
  const userId = getUserId(c);
  const projectId = c.req.query("projectId");
  const archived = c.req.query("archived") ?? "active";
  if (archived !== "active" && archived !== "only" && archived !== "include") {
    return c.json({ error: "archived must be active, only, or include" }, 400);
  }

  const predicates = ["user_id = ?"];
  const bindings: string[] = [userId];
  if (projectId) {
    predicates.push("project_id = ?");
    bindings.push(projectId);
  }
  if (archived === "active") predicates.push("archived_at IS NULL");
  if (archived === "only") predicates.push("archived_at IS NOT NULL");

  const { results } = await c.env.DB.prepare(
    `SELECT id, thread_id, project_id, title, archived_at, created_at, updated_at FROM chat_session WHERE ${predicates.join(" AND ")} ORDER BY updated_at DESC LIMIT 50`,
  )
    .bind(...bindings)
    .all<SessionRow>();

  return c.json({ sessions: (results ?? []).map(publicSession) });
});

sessionRoutes.patch("/:threadId", async (c) => {
  const userId = getUserId(c);
  const threadId = c.req.param("threadId");
  const body: { archived?: unknown } = await c.req
    .json<{ archived?: unknown }>()
    .catch(() => ({}));
  if (typeof body.archived !== "boolean") {
    return c.json({ error: "archived must be a boolean" }, 400);
  }
  const session = await c.env.DB.prepare(
    "SELECT id FROM chat_session WHERE thread_id = ? AND user_id = ? LIMIT 1",
  )
    .bind(threadId, userId)
    .first();
  if (!session) return c.json({ error: "Session not found" }, 404);

  await c.env.DB.prepare(
    body.archived
      ? "UPDATE chat_session SET archived_at = unixepoch(), updated_at = unixepoch() WHERE thread_id = ? AND user_id = ?"
      : "UPDATE chat_session SET archived_at = NULL, updated_at = unixepoch() WHERE thread_id = ? AND user_id = ?",
  )
    .bind(threadId, userId)
    .run();
  return c.json({ ok: true, archived: body.archived, threadId });
});

// POST /api/v1/sessions — create or update session
sessionRoutes.post("/", async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    projectId?: string;
    threadId?: string;
    title?: string;
  }>();
  const { projectId, title } = body;
  if (!projectId) return c.json({ error: "Missing projectId" }, 400);

  // Use provided threadId or generate a new one
  const threadId =
    body.threadId ||
    `${Date.now()}${Math.random().toString(36).substring(2, 9)}`;

  const existing = await c.env.DB.prepare(
    "SELECT id FROM chat_session WHERE thread_id = ?",
  )
    .bind(threadId)
    .first();

  if (existing) {
    await c.env.DB.prepare(
      "UPDATE chat_session SET title = ?, updated_at = unixepoch() WHERE thread_id = ?",
    )
      .bind(title || null, threadId)
      .run();
  } else {
    await c.env.DB.prepare(
      "INSERT INTO chat_session (id, project_id, user_id, thread_id, title) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), projectId, userId, threadId, title || null)
      .run();
  }

  return c.json({ ok: true, threadId });
});

// DELETE /api/v1/sessions?threadId=xxx
sessionRoutes.delete("/", async (c) => {
  const userId = getUserId(c);
  const threadId = c.req.query("threadId");
  if (!threadId) return c.json({ error: "Missing threadId" }, 400);

  await c.env.DB.prepare(
    "DELETE FROM chat_session WHERE thread_id = ? AND user_id = ?",
  )
    .bind(threadId, userId)
    .run();

  return c.json({ ok: true });
});
