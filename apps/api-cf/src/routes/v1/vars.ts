/**
 * User Variables API — encrypted key-value store for action secrets.
 *
 * PUT    /api/v1/vars/:key   → Set or update a variable
 * GET    /api/v1/vars        → List variable keys (no values)
 * DELETE /api/v1/vars/:key   → Delete a variable
 */

import { Hono } from "hono";
import type { Env } from "../../config";
import { setVariable, listVariableKeys, deleteVariable } from "../../services/user-variables";

export const varsRoutes = new Hono<{ Bindings: Env }>();

// PUT /api/v1/vars/:key
varsRoutes.put("/:key", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const key = c.req.param("key");
  const body = await c.req.json<{ value: string }>();
  if (!body.value) return c.json({ error: "Missing value" }, 400);

  const secretKey = c.env.ACTION_SECRET_KEY;
  if (!secretKey) return c.json({ error: "Server not configured for variable encryption" }, 500);

  await setVariable(c.env.DB, userId, key, body.value, secretKey);
  return c.json({ ok: true, key });
});

// GET /api/v1/vars
varsRoutes.get("/", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const vars = await listVariableKeys(c.env.DB, userId);
  return c.json({ variables: vars });
});

// DELETE /api/v1/vars/:key
varsRoutes.delete("/:key", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const key = c.req.param("key");
  const deleted = await deleteVariable(c.env.DB, userId, key);
  if (!deleted) return c.json({ error: "Variable not found" }, 404);
  return c.json({ ok: true, key });
});
