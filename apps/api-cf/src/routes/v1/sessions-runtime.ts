/**
 * /api/v1/runtimes/:rid/sessions and /api/v1/sessions/:sid/* — browser-side
 * session lifecycle for the local-runtime model.
 *
 * NOTE: this lives next to the older `sessions.ts` (which is unrelated —
 * it's the cloud-chat session table). Naming is "sessions-runtime" to
 * keep them apart in imports until the cloud one moves under a different
 * prefix.
 *
 * Routes (all auth'd via x-user-id middleware in app.ts):
 *   POST   /api/v1/runtimes/:rid/sessions
 *     { agent_id, cwd?, resume_session_id? }
 *     → { session_id }
 *     Creates a runtime_session row, tells the daemon (via RuntimeRoom DO
 *     `sendToDaemon`) to start the agent, returns immediately. The browser
 *     then opens the WS stream below to receive the ready/event/complete
 *     stream.
 *
 *   GET    /api/v1/sessions
 *     → { sessions: [...] }   most-recent-first, max 50
 *
 *   GET    /api/v1/sessions/:sid           → { session }
 *
 *   DELETE /api/v1/sessions/:sid
 *     → 204
 *     Tells the daemon to dispose. Marks runtime_session.status = 'closed'.
 *
 *   GET    /api/v1/sessions/:sid/_stream   (WebSocket upgrade)
 *     Browser ↔ DO duplex. Send {prompt|cancel|dispose}; receive
 *     {attached|daemon_online|daemon_offline|session.ready|session.event|
 *      session.complete|session.error|session.disposed}.
 */

import { Hono } from "hono";
import type { Env } from "../../config";

export const sessionsRuntimeRoutes = new Hono<{ Bindings: Env }>();

// Session creation lives in routes/v1/runtimes.ts as
// POST /api/v1/runtimes/:rid/sessions — it's a runtime-scoped action.
// Everything else (read / list / delete / WS stream) is here.

// GET /api/v1/sessions
sessionsRuntimeRoutes.get("/", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const { results } = await c.env.DB.prepare(
    `SELECT id, runtime_id, agent_id, acp_session_id, cwd, title, status, created_at, last_active_at
     FROM runtime_session WHERE user_id = ? ORDER BY last_active_at DESC LIMIT 50`,
  ).bind(userId).all();
  return c.json({ sessions: results ?? [] });
});

// GET /api/v1/sessions/:sid
sessionsRuntimeRoutes.get("/:sid", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const session = await c.env.DB.prepare(
    `SELECT id, runtime_id, agent_id, acp_session_id, cwd, title, status, created_at, last_active_at
     FROM runtime_session WHERE id = ? AND user_id = ?`,
  ).bind(c.req.param("sid"), userId).first();
  if (!session) return c.json({ error: "not found" }, 404);
  return c.json({ session });
});

// DELETE /api/v1/sessions/:sid — tell daemon to dispose, mark row closed.
sessionsRuntimeRoutes.delete("/:sid", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const sid = c.req.param("sid");
  const session = await c.env.DB.prepare(
    "SELECT id, runtime_id FROM runtime_session WHERE id = ? AND user_id = ?",
  ).bind(sid, userId).first<{ id: string; runtime_id: string }>();
  if (!session) return c.json({ error: "not found" }, 404);

  const doStub = c.env.RUNTIME_ROOM.get(c.env.RUNTIME_ROOM.idFromName(session.runtime_id));
  await (doStub as unknown as {
    sendToDaemon(msg: Record<string, unknown>): Promise<boolean>;
  }).sendToDaemon({ type: "session.dispose", session_id: sid }).catch(() => false);

  await c.env.DB.prepare(
    "UPDATE runtime_session SET status = 'closed' WHERE id = ?",
  ).bind(sid).run();

  return c.body(null, 204);
});

// GET /api/v1/sessions/:sid/_stream  (WebSocket upgrade)
sessionsRuntimeRoutes.get("/:sid/_stream", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("WebSocket only", 400);
  }
  const userId = c.req.header("x-user-id");
  if (!userId) return c.text("unauthorized", 401);

  const sid = c.req.param("sid");
  const session = await c.env.DB.prepare(
    "SELECT id, runtime_id FROM runtime_session WHERE id = ? AND user_id = ?",
  ).bind(sid, userId).first<{ id: string; runtime_id: string }>();
  if (!session) return c.text("not found", 404);

  const doStub = c.env.RUNTIME_ROOM.get(c.env.RUNTIME_ROOM.idFromName(session.runtime_id));
  const fwd = new Request(c.req.raw);
  fwd.headers.set("x-attach-role", "client");
  fwd.headers.set("x-session-id", sid);
  fwd.headers.set("x-session-user", userId);
  return doStub.fetch(fwd);
});
