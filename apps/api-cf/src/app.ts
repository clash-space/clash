/**
 * Hono app factory.
 *
 * OSS deployments call createApp() with no plugins → all hook sites run
 * their default behavior. Hosted (or any downstream) deployments call
 * createApp({ plugins: [...] }) to install plugin hooks before any
 * request or workflow runs.
 *
 * Workflow / Durable Object bodies share the same JS isolate as the
 * fetch handler, so the plugin registry installed here is also visible
 * to GenerationWorkflow.run, ProjectRoom, etc.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";

import type { Env } from "./config";
import { api } from "./routes/index";
import { v1Routes } from "./routes/v1/index";
import { assetRoutes } from "./routes/assets";
import { thumbnailRoutes } from "./routes/thumbnails";
import { betterAuthRoutes } from "./routes/better-auth";
import { setPlugins, getPlugins } from "./plugins/registry";
import type { Plugin } from "./plugins/types";

export interface CreateAppOptions {
  plugins?: Plugin[];
}

export function createApp(opts: CreateAppOptions = {}): Hono<{ Bindings: Env }> {
  setPlugins(opts.plugins ?? []);

  const app = new Hono<{ Bindings: Env }>();

  app.use("/*", cors());

  // ─── WebSocket: /sync/:projectId → ProjectRoom DO ──────────
  app.all("/sync/:projectId{.*}", async (c) => {
    const rawProjectId = c.req.param("projectId");
    const projectId = rawProjectId.split("/")[0];
    const id = c.env.ROOM.idFromName(projectId);
    return c.env.ROOM.get(id).fetch(c.req.raw);
  });

  // ─── AI Chat: /agents/supervisor/:room → SupervisorAgent DO ──
  // Room name format: "projectId:agentId" — each room is an independent agent instance.
  // Multiple agents can share the same project canvas via ProjectRoom.
  app.all("/agents/supervisor/:room{.*}", async (c) => {
    const rawRoom = c.req.param("room");
    const room = rawRoom.split("/")[0];
    const id = c.env.SUPERVISOR.idFromName(room);
    const req = new Request(c.req.raw);
    req.headers.set("x-partykit-room", room);
    req.headers.set("x-partykit-namespace", "SUPERVISOR");
    return c.env.SUPERVISOR.get(id).fetch(req);
  });

  // ─── Asset routes (ported from loro-sync-server) ────────────
  app.route("/assets", assetRoutes);
  app.route("/upload", assetRoutes);
  app.route("/thumbnails", thumbnailRoutes);

  // ─── Better Auth — runs server-side so frontends just proxy ──
  app.route("/api/better-auth", betterAuthRoutes);

  // ─── Public REST API v1 ─────────────────────────────────────
  app.route("/api/v1", v1Routes);

  // ─── REST API routes ────────────────────────────────────────
  app.route("/", api);

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  // ─── Plugin-mounted routes (e.g. /api/v1/billing/*) ─────────
  // Run after core routes so plugins can override or extend them.
  getPlugins().routes?.register?.(app);

  return app;
}
