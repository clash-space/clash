import { Hono } from "hono";
import type { Env } from "../../config";
import {
  getProjectById,
  listProjectsWithAssets,
} from "../../services/projects-d1";

export const projectRoutes = new Hono<{ Bindings: Env }>();

/**
 * Extract user ID from x-user-id header (set by auth-gateway).
 */
function getUserId(c: {
  req: { header: (name: string) => string | undefined };
}): string {
  const userId = c.req.header("x-user-id");
  if (!userId) throw new Error("Missing x-user-id header");
  return userId;
}

// GET /api/v1/projects — List user's projects
projectRoutes.get("/", async (c) => {
  const userId = getUserId(c);
  const archived = c.req.query("archived") ?? "active";
  if (archived !== "active" && archived !== "only" && archived !== "include") {
    return c.json({ error: "archived must be active, only, or include" }, 400);
  }
  return c.json({
    projects: await listProjectsWithAssets(c.env, userId, 50, archived),
  });
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
    "INSERT INTO project (id, owner_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, strftime('%s','now'), strftime('%s','now'))",
  )
    .bind(id, userId, body.name.trim(), body.description?.trim() ?? null)
    .run();

  return c.json(
    {
      id,
      name: body.name.trim(),
      description: body.description?.trim() ?? null,
    },
    201,
  );
});

// GET /api/v1/projects/:id — Get project details
projectRoutes.get("/:id", async (c) => {
  const userId = getUserId(c);
  const projectId = c.req.param("id");
  const project = await getProjectById(c.env, userId, projectId);
  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  return c.json(project);
});

// PATCH /api/v1/projects/:id — Rename a project
projectRoutes.patch("/:id", async (c) => {
  const userId = getUserId(c);
  const projectId = c.req.param("id");
  const body = await c.req
    .json<{ name?: string }>()
    .catch((): { name?: string } => ({}));
  const name = body.name?.trim();
  if (!name) return c.json({ error: "name is required" }, 400);

  const { results } = await c.env.DB.prepare(
    "SELECT id FROM project WHERE id = ? AND owner_id = ? AND deleted_at IS NULL LIMIT 1",
  )
    .bind(projectId, userId)
    .all();

  if (!results?.length) {
    return c.json({ error: "Project not found" }, 404);
  }

  await c.env.DB.prepare(
    "UPDATE project SET name = ?, updated_at = strftime('%s','now') WHERE id = ? AND owner_id = ?",
  )
    .bind(name, projectId, userId)
    .run();

  return c.json({ ok: true, id: projectId, name });
});

// DELETE /api/v1/projects/:id — Archive a project
projectRoutes.delete("/:id", async (c) => {
  const userId = getUserId(c);
  const projectId = c.req.param("id");

  const { results } = await c.env.DB.prepare(
    "SELECT id FROM project WHERE id = ? AND owner_id = ? AND deleted_at IS NULL LIMIT 1",
  )
    .bind(projectId, userId)
    .all();

  if (!results?.length) {
    return c.json({ error: "Project not found" }, 404);
  }

  await c.env.DB.prepare(
    "UPDATE project SET deleted_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND owner_id = ? AND deleted_at IS NULL",
  )
    .bind(projectId, userId)
    .run();

  return c.json({ archived: true, recoverable: true, id: projectId });
});

projectRoutes.post("/:id/restore", async (c) => {
  const userId = getUserId(c);
  const projectId = c.req.param("id");
  const project = await c.env.DB.prepare(
    "SELECT id FROM project WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL LIMIT 1",
  )
    .bind(projectId, userId)
    .first();
  if (!project) return c.json({ error: "Archived project not found" }, 404);

  await c.env.DB.prepare(
    "UPDATE project SET deleted_at = NULL, updated_at = unixepoch() WHERE id = ? AND owner_id = ?",
  )
    .bind(projectId, userId)
    .run();
  return c.json({ restored: true, id: projectId });
});

projectRoutes.delete("/:id/purge", async (c) => {
  const userId = getUserId(c);
  const projectId = c.req.param("id");
  const body: { confirm?: string } = await c.req
    .json<{ confirm?: string }>()
    .catch(() => ({}));
  if (body.confirm !== "purge") {
    return c.json({ error: 'confirm must be "purge"' }, 400);
  }
  const project = await c.env.DB.prepare(
    "SELECT id FROM project WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL LIMIT 1",
  )
    .bind(projectId, userId)
    .first();
  if (!project) return c.json({ error: "Archived project not found" }, 404);

  await c.env.DB.prepare(
    "DELETE FROM project WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL",
  )
    .bind(projectId, userId)
    .run();
  return c.json({ purged: true, id: projectId });
});
