import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Env } from "../config";
import { getDb } from "../db";
import { projects } from "../db/app.schema";
import { getUserIdFromRequest } from "../services/session";

export const internalProjectsContextRoutes = new Hono<{ Bindings: Env }>();

internalProjectsContextRoutes.get("/:projectId/context", async (c) => {
  const userId = await getUserIdFromRequest(c.req.raw, c.env as any, c.req.raw.cf as any);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const projectId = c.req.param("projectId");
  const db = getDb(c.env.DB);
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
  if (!project) return c.json({ error: "Not found" }, 404);
  if (project.ownerId !== userId) return c.json({ error: "Forbidden" }, 403);
  return c.json({ nodes: [], edges: [] });
});
