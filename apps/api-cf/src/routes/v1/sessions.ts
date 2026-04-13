import { Hono } from "hono";
import type { Env } from "../../config";

export const sessionRoutes = new Hono<{ Bindings: Env }>();

function getUserId(c: { req: { header: (name: string) => string | undefined } }): string {
  const userId = c.req.header("x-user-id");
  if (!userId) throw new Error("Missing x-user-id header");
  return userId;
}

// GET /api/v1/sessions?projectId=xxx
sessionRoutes.get("/", async (c) => {
  const userId = getUserId(c);
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "Missing projectId" }, 400);

  const { results } = await c.env.DB.prepare(
    "SELECT id, thread_id, title, created_at, updated_at FROM chat_session WHERE project_id = ? AND user_id = ? ORDER BY updated_at DESC LIMIT 50"
  ).bind(projectId, userId).all();

  return c.json({ sessions: results ?? [] });
});

// POST /api/v1/sessions — create or update session
sessionRoutes.post("/", async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{ projectId?: string; threadId?: string; title?: string }>();
  const { projectId, title } = body;
  if (!projectId) return c.json({ error: "Missing projectId" }, 400);

  // Use provided threadId or generate a new one
  const threadId = body.threadId || `${Date.now()}${Math.random().toString(36).substring(2, 9)}`;

  const existing = await c.env.DB.prepare(
    "SELECT id FROM chat_session WHERE thread_id = ?"
  ).bind(threadId).first();

  if (existing) {
    await c.env.DB.prepare(
      "UPDATE chat_session SET title = ?, updated_at = unixepoch() WHERE thread_id = ?"
    ).bind(title || null, threadId).run();
  } else {
    await c.env.DB.prepare(
      "INSERT INTO chat_session (id, project_id, user_id, thread_id, title) VALUES (?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), projectId, userId, threadId, title || null).run();
  }

  return c.json({ ok: true, threadId });
});

// DELETE /api/v1/sessions?threadId=xxx
sessionRoutes.delete("/", async (c) => {
  const userId = getUserId(c);
  const threadId = c.req.query("threadId");
  if (!threadId) return c.json({ error: "Missing threadId" }, 400);

  await c.env.DB.prepare(
    "DELETE FROM chat_session WHERE thread_id = ? AND user_id = ?"
  ).bind(threadId, userId).run();

  return c.json({ ok: true });
});
