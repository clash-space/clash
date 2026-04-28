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
import { projectsD1Routes } from "./routes/projects-d1";
import { internalProjectsContextRoutes } from "./routes/internal-projects-context";
import { settingsD1Routes } from "./routes/settings-d1";
import { marketplaceRoutes } from "./routes/marketplace";
import { byoBridgeRoutes } from "./routes/byo-bridge";
import { runtimeDaemonRoutes } from "./routes/v1/runtimes";
import { authenticateRuntimeToken } from "./routes/v1/runtimes";
import { setPlugins, getPlugins } from "./plugins/registry";
import type { Plugin } from "./plugins/types";
import { getUserIdFromApiToken, getUserIdFromRequest } from "./services/session";

export interface CreateAppOptions {
  plugins?: Plugin[];
}

export function createApp(opts: CreateAppOptions = {}): Hono<{ Bindings: Env }> {
  setPlugins(opts.plugins ?? []);

  const app = new Hono<{ Bindings: Env }>();

  app.use("/*", cors());

  // For /api/v1/* (and other token/header-auth endpoints), let Better Auth
  // session cookies stand in for x-user-id. CLI / external integrations keep
  // setting x-user-id directly (via gateway) — only fill in when missing.
  app.use("/api/v1/*", async (c, next) => {
    if (!c.req.header("x-user-id")) {
      const userId =
        (await getUserIdFromApiToken(c.req.raw, c.env as any)) ??
        (await getUserIdFromRequest(
          c.req.raw,
          c.env as any,
          c.req.raw.cf as any,
        ));
      if (userId) {
        const req = new Request(c.req.raw);
        req.headers.set("x-user-id", userId);
        c.req.raw = req;
      }
    }
    await next();
  });

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
    // Resolve userId at the gateway so supervisor logs can be filtered per user.
    // Best-effort: don't 401 here — the WS handshake is what carries the cookie,
    // and DO has no other way to learn the user.
    try {
      const userId =
        (await getUserIdFromApiToken(c.req.raw, c.env as any)) ??
        (await getUserIdFromRequest(
          c.req.raw,
          c.env as any,
          c.req.raw.cf as any,
        ));
      if (userId) req.headers.set("x-user-id", userId);
    } catch { /* observability only — never block the connection */ }
    return c.env.SUPERVISOR.get(id).fetch(req);
  });

  // ─── BYO local agent bridge ────────────────────────────────
  // Auto-fill x-user-id from Better Auth so the route + DO can use it.
  // (CLI side is exempt: its credential is the pair token, not a session cookie.)
  app.use("/agents/byo-bridge/pair", async (c, next) => {
    if (!c.req.header("x-user-id")) {
      const userId =
        (await getUserIdFromApiToken(c.req.raw, c.env as any)) ??
        (await getUserIdFromRequest(c.req.raw, c.env as any, c.req.raw.cf as any));
      if (userId) {
        const req = new Request(c.req.raw);
        req.headers.set("x-user-id", userId);
        c.req.raw = req;
      }
    }
    await next();
  });
  app.use("/agents/byo-bridge/browser", async (c, next) => {
    if (!c.req.header("x-user-id")) {
      const userId =
        (await getUserIdFromApiToken(c.req.raw, c.env as any)) ??
        (await getUserIdFromRequest(c.req.raw, c.env as any, c.req.raw.cf as any));
      if (userId) {
        const req = new Request(c.req.raw);
        req.headers.set("x-user-id", userId);
        c.req.raw = req;
      }
    }
    await next();
  });
  app.route("/agents/byo-bridge", byoBridgeRoutes);

  // ─── Local runtime daemon ──────────────────────────────────
  // Daemon-side endpoints — auth is in the request body/header (one-time
  // code or sk_machine_* bearer token), NOT a session cookie. Mounted
  // outside /api/v1/ so the gateway doesn't enforce user auth.
  app.route("/agents/runtime", runtimeDaemonRoutes);

  // WS attach for the long-running daemon ↔ RuntimeRoom DO link.
  // Bearer token in Authorization header → identifies which runtime row.
  // We resolve the token here (rather than inside the DO) so the DO never
  // sees raw secrets and so we can 401 cheaply without spinning a DO.
  app.get("/agents/runtime/_attach", async (c) => {
    if (c.req.header("Upgrade") !== "websocket") {
      return c.text("WebSocket only", 400);
    }
    const auth = c.req.header("Authorization") ?? c.req.header("authorization") ?? "";
    if (!auth) return c.text("missing Authorization", 401);
    const ident = await authenticateRuntimeToken(c.env, auth);
    if (!ident) return c.text("invalid token", 401);

    const id = c.env.RUNTIME_ROOM.idFromName(ident.runtime_id);
    const fwd = new Request(c.req.raw);
    fwd.headers.set("x-attach-role", "daemon");
    fwd.headers.set("x-runtime-id", ident.runtime_id);
    fwd.headers.set("x-runtime-user", ident.user_id);
    return c.env.RUNTIME_ROOM.get(id).fetch(fwd);
  });

  // ─── Asset routes (ported from loro-sync-server) ────────────
  app.route("/assets", assetRoutes);
  app.route("/upload", assetRoutes);
  app.route("/thumbnails", thumbnailRoutes);

  // ─── Better Auth — runs server-side so frontends just proxy ──
  app.route("/api/better-auth", betterAuthRoutes);

  // ─── Public REST API v1 ─────────────────────────────────────
  app.route("/api/v1", v1Routes);

  // ─── OSS web's /api/* endpoints (ported from apps/web) ──────
  app.route("/api/projects", projectsD1Routes);
  app.route("/api/internal/projects", internalProjectsContextRoutes);
  app.route("/api/settings", settingsD1Routes);
  app.route("/api/marketplace", marketplaceRoutes);

  // ─── REST API routes ────────────────────────────────────────
  app.route("/", api);

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  // ─── Plugin-mounted routes (e.g. /api/v1/billing/*) ─────────
  // Run after core routes so plugins can override or extend them.
  getPlugins().routes?.register?.(app);

  return app;
}
