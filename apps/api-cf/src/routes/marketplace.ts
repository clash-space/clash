import { Hono } from "hono";
import type { Env } from "../config";

const REGISTRY_URL =
  "https://raw.githubusercontent.com/clash-community/awesome-actions/main/registry.json";

const FALLBACK = { version: 1, actions: [], skills: [] };

export const marketplaceRoutes = new Hono<{ Bindings: Env }>();

marketplaceRoutes.get("/registry", async (c) => {
  try {
    const res = await fetch(REGISTRY_URL);
    if (!res.ok) return c.json(FALLBACK);
    return c.json(await res.json());
  } catch {
    return c.json(FALLBACK);
  }
});
