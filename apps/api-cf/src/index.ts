import { Hono } from "hono";
import { cors } from "hono/cors";

import type { Env } from "./config";
import { api } from "./routes/index";
import { assetRoutes } from "./routes/assets";
import { thumbnailRoutes } from "./routes/thumbnails";
import { ProjectRoom } from "./agents/project-room";
import { SupervisorAgent } from "./agents/supervisor";
import { GenerationWorkflow } from "./agents/generation";

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
  // :room{.*} captures "projectId:agentId" and any sub-path (e.g., "/get-messages").
  // Extract just the room name (before any "/") for DO routing.
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

// ─── REST API routes ────────────────────────────────────────
app.route("/", api);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Export for Cloudflare Workers
export default app;

// Export Durable Object classes and Workflow
export { ProjectRoom, SupervisorAgent, GenerationWorkflow };
