import { Hono } from "hono";
import type { Env } from "../../config";
import { listProviderUsageEvents } from "../../services/provider-usage";

export const providerUsageRoutes = new Hono<{ Bindings: Env }>();

providerUsageRoutes.get("/provider-usage", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const parsedLimit = Number.parseInt(c.req.query("limit") ?? "100", 10);
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : 100;
  return c.json({ events: await listProviderUsageEvents(c.env.DB, userId, limit) });
});
