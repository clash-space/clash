import { listModelCatalogEntries } from "@clash/shared-types";
import { Hono } from "hono";
import type { Env } from "../../config";
import {
  listProviderAccounts,
  normalizeProviderAccountInput,
  upsertProviderAccounts,
} from "../../services/provider-accounts";

export const modelProviderRoutes = new Hono<{ Bindings: Env }>();

modelProviderRoutes.get("/model-providers", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ providers: await listProviderAccounts(c.env.DB, userId) });
});

modelProviderRoutes.patch("/model-providers", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { providers?: unknown };
  const providers = Array.isArray(body.providers)
    ? body.providers.map(normalizeProviderAccountInput)
    : [];
  if (providers.length === 0 || providers.some((provider) => !provider)) {
    return c.json({ error: "Invalid providers" }, 400);
  }
  const saved = await upsertProviderAccounts(c.env, userId, providers.filter((provider) => !!provider));
  return c.json({ providers: saved });
});

modelProviderRoutes.get("/models/catalog", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const providers = await listProviderAccounts(c.env.DB, userId);
  return c.json({
    models: listModelCatalogEntries({ configuredProviders: providers }),
  });
});
