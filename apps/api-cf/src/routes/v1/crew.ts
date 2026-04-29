/**
 * /api/v1/crew — claimed crew members.
 *
 * A "claim" couples a bundled crew template (Director / Canvas Editor /
 * …) with one of the user's runtimes, producing a concrete crew member
 * the user can invite into project rooms. See drizzle/0012_crew_member.sql
 * for the why-this-layer rationale.
 *
 * Routes (all auth'd via x-user-id middleware in app.ts):
 *   GET    /api/v1/crew                → { crew: [...] }
 *     Lists user's claimed crew. Joins runtime label so the UI can show
 *     "Director · alice-mac" without a second round-trip.
 *
 *   POST   /api/v1/crew                → { id, … }
 *     { template_id, runtime_id, display_name? }
 *     - template_id must be one of the bundled (BUILTIN_TEMPLATES below).
 *       The actual role definition lives in the bridge daemon's dist/
 *       crew/<id>/, so the server can't introspect it; allow-list is the
 *       backstop. Bundled set rarely changes — when it does, bump this
 *       array and ship a new beta.
 *     - runtime_id must belong to the calling user.
 *     - display_name defaults to the template's human label ("Director")
 *       so v1 users don't have to think about naming. They can rename
 *       (PATCH) later when they claim a second instance.
 *
 *   DELETE /api/v1/crew/:id            → 204
 *     Just unclaims — does NOT cascade to existing runtime_session rows
 *     (those keep working until the user manually closes the chat).
 *     If you need orphan-aware cleanup, do it in a separate sweep.
 */

import { Hono } from "hono";
import type { Env } from "../../config";

export const crewRoutes = new Hono<{ Bindings: Env }>();

/**
 * Bundled crew templates the bridge ships in dist/crew/. Server-side
 * allow-list — kept in lockstep with packages/clash-bridge/assets/crew/.
 * Adding a new template = ship a new bridge beta + update this array +
 * the BUILTIN_CREW lists in the web UI (RuntimePickerDialog,
 * GroupChatPanel). Three places, but each is a one-liner.
 */
const BUILTIN_TEMPLATES: Record<string, { label: string }> = {
  "director":        { label: "Director" },
  "canvas-editor":   { label: "Canvas Editor" },
  "generator":       { label: "Generator" },
  "storyboard":      { label: "Storyboard Artist" },
  "project-manager": { label: "Project Manager" },
};

interface CrewRow {
  id: string;
  user_id: string;
  template_id: string;
  runtime_id: string;
  agent_id: string | null;
  display_name: string;
  created_at: number;
}

interface CrewJoinRow extends CrewRow {
  runtime_hostname: string | null;
  runtime_status: string | null;
  runtime_agents_json: string | null;
}

// GET /api/v1/crew
crewRoutes.get("/", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  // runtime.label doesn't exist; UI label is hostname (with os as a
  // small qualifier — see RuntimesSection in SettingsClient).
  const { results } = await c.env.DB.prepare(
    `SELECT
        cm.id, cm.user_id, cm.template_id, cm.runtime_id, cm.agent_id,
        cm.display_name, cm.created_at,
        r.hostname    AS runtime_hostname,
        r.status      AS runtime_status,
        r.agents_json AS runtime_agents_json
     FROM crew_member cm
     LEFT JOIN runtime r ON r.id = cm.runtime_id
     WHERE cm.user_id = ?
     ORDER BY cm.created_at ASC`,
  ).bind(userId).all<CrewJoinRow>();

  // Map runtime_hostname → runtime_label so the UI can stay generic if
  // the underlying column moves later (e.g., when we add an explicit
  // user-set label column).
  const crew = (results ?? []).map((r) => ({
    id: r.id,
    user_id: r.user_id,
    template_id: r.template_id,
    runtime_id: r.runtime_id,
    agent_id: r.agent_id,
    display_name: r.display_name,
    created_at: r.created_at,
    runtime_label: r.runtime_hostname,
    runtime_status: r.runtime_status,
    runtime_agents: r.runtime_agents_json
      ? (JSON.parse(r.runtime_agents_json) as Array<{ id: string }>)
      : [],
  }));

  return c.json({ crew });
});

// POST /api/v1/crew
crewRoutes.post("/", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const body = (await c.req.json().catch(() => ({}))) as {
    template_id?: string;
    runtime_id?: string;
    agent_id?: string;
    display_name?: string;
  };

  const tplId = body.template_id?.trim() ?? "";
  const tpl = BUILTIN_TEMPLATES[tplId];
  if (!tpl) {
    return c.json({ error: `unknown template: ${tplId || "(none)"}` }, 400);
  }

  const rid = body.runtime_id?.trim() ?? "";
  if (!rid) return c.json({ error: "runtime_id required" }, 400);

  const agentId = body.agent_id?.trim() ?? "";
  if (!agentId) return c.json({ error: "agent_id required" }, 400);

  // Verify runtime ownership AND that the requested agent is detected
  // on it. agents_json is what the daemon reported at attach time;
  // claiming an agent that isn't on PATH would just fail at session
  // spawn, so reject upfront.
  const runtime = await c.env.DB.prepare(
    "SELECT id, agents_json FROM runtime WHERE id = ? AND owner_user_id = ?",
  ).bind(rid, userId).first<{ id: string; agents_json: string }>();
  if (!runtime) return c.json({ error: "runtime not found" }, 404);

  const detected = (() => {
    try {
      const arr = JSON.parse(runtime.agents_json ?? "[]");
      return Array.isArray(arr) ? arr.map((a) => a?.id).filter(Boolean) : [];
    } catch { return []; }
  })();
  if (!detected.includes(agentId)) {
    return c.json({
      error: `agent '${agentId}' not detected on runtime; available: ${detected.join(", ") || "(none)"}`,
    }, 400);
  }

  const id = crypto.randomUUID();
  const at = Math.floor(Date.now() / 1000);
  const displayName = body.display_name?.trim() || tpl.label;

  await c.env.DB.prepare(
    `INSERT INTO crew_member
     (id, user_id, template_id, runtime_id, agent_id, display_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, userId, tplId, rid, agentId, displayName, at).run();

  return c.json({
    id,
    user_id: userId,
    template_id: tplId,
    runtime_id: rid,
    agent_id: agentId,
    display_name: displayName,
    created_at: at,
  }, 201);
});

// DELETE /api/v1/crew/:id
crewRoutes.delete("/:id", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const id = c.req.param("id");
  const owns = await c.env.DB.prepare(
    "SELECT id FROM crew_member WHERE id = ? AND user_id = ?",
  ).bind(id, userId).first<{ id: string }>();
  if (!owns) return c.json({ error: "not found" }, 404);

  await c.env.DB.prepare("DELETE FROM crew_member WHERE id = ?").bind(id).run();
  return c.body(null, 204);
});
