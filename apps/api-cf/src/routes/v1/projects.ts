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
