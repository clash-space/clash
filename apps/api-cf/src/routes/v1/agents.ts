/**
 * /api/v1/agents — claimed agent members.
 *
 * A "claim" couples a bundled agent template (Director / Canvas Editor /
 * …) with one of the user's runtimes, producing a concrete agent member
 * the user can invite into project rooms. See drizzle/0012_agent_member.sql
 * for the why-this-layer rationale.
 *
 * Routes (all auth'd via x-user-id middleware in app.ts):
 *   GET    /api/v1/agents               → { agents: [...] }
 *     Lists user's claimed agents. Joins runtime label so the UI can show
 *     "Director · alice-mac" without a second round-trip.
 *
 *   POST   /api/v1/agents               → { id, … }
 *     { template_id, runtime_id, display_name? }
 *     - template_id must be one of the bundled (BUILTIN_TEMPLATES below).
 *       The actual role definition lives in the local host's packaged runtime/
 *       agents/<id>/, so the server can't introspect it; allow-list is the
 *       backstop. Bundled set rarely changes — when it does, bump this
 *       array and ship a new beta.
 *     - runtime_id must belong to the calling user.
 *     - display_name defaults to the template's human label ("Director")
 *       so v1 users don't have to think about naming. They can rename
 *       (PATCH) later when they claim a second instance.
 *
 *   DELETE /api/v1/agents/:id           → 204
 *     Just unclaims — does NOT cascade to existing runtime_session rows
 *     (those keep working until the user manually closes the chat).
 *     If you need orphan-aware cleanup, do it in a separate sweep.
 */

import { Hono } from "hono";
import type { Env } from "../../config";
import { deriveRuntimeStatus } from "../../lib/runtime-status";

export const agentRoutes = new Hono<{ Bindings: Env }>();

/**
 * Bundled agent templates the Clash runtime ships in runtime/agents/. Server-side
 * allow-list — kept in lockstep with packages/cli/assets/agents/.
 * Adding a new template = ship a new Clash runtime + update this array +
 * the BUILTIN_AGENT lists in the web UI (RuntimePickerDialog,
 * GroupChatPanel). Three places, but each is a one-liner.
 */
const BUILTIN_TEMPLATES: Record<string, { label: string }> = {
  "director":        { label: "Director" },
  "canvas-editor":   { label: "Canvas Editor" },
  "generator":       { label: "Generator" },
  "storyboard":      { label: "Storyboard Artist" },
  "project-manager": { label: "Project Manager" },
};

interface AgentRow {
  id: string;
  user_id: string;
  template_id: string;
  runtime_id: string;
  agent_id: string | null;
  display_name: string;
  created_at: number;
  // Phase 0 multi-actor billing — see drizzle/0015_agent_member_budget.sql.
  budget_credits: number | null;
  budget_period: string | null;
  budget_used: number | null;
  budget_reset_at: number | null;
}

interface AgentJoinRow extends AgentRow {
  runtime_hostname: string | null;
  runtime_status: string | null;
  runtime_last_heartbeat: number | null;
  runtime_agents_json: string | null;
}

// GET /api/v1/agents
agentRoutes.get("/", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  // runtime.label doesn't exist; UI label is hostname (with os as a
  // small qualifier — see RuntimesSection in SettingsClient).
  const { results } = await c.env.DB.prepare(
    `SELECT
        cm.id, cm.user_id, cm.template_id, cm.runtime_id, cm.agent_id,
        cm.display_name, cm.created_at,
        cm.budget_credits, cm.budget_period, cm.budget_used, cm.budget_reset_at,
        r.hostname       AS runtime_hostname,
        r.status         AS runtime_status,
        r.last_heartbeat AS runtime_last_heartbeat,
        r.agents_json    AS runtime_agents_json
     FROM agent_member cm
     LEFT JOIN runtime r ON r.id = cm.runtime_id
     WHERE cm.user_id = ?
     ORDER BY cm.created_at ASC`,
  ).bind(userId).all<AgentJoinRow>();

  // Map runtime_hostname → runtime_label so the UI can stay generic if
  // the underlying column moves later (e.g., when we add an explicit
  // user-set label column). `runtime_status` goes through the shared
  // staleness derivation so the Settings → Agent section reads the
  // same truth as the chat panel rail — daemon dead > 90s flips to
  // 'offline' even if the row's raw status column still says 'online'.
  const agents = (results ?? []).map((r) => ({
    id: r.id,
    user_id: r.user_id,
    template_id: r.template_id,
    runtime_id: r.runtime_id,
    agent_id: r.agent_id,
    display_name: r.display_name,
    created_at: r.created_at,
    runtime_label: r.runtime_hostname,
    runtime_status: r.runtime_status == null
      ? null
      : deriveRuntimeStatus(r.runtime_status, r.runtime_last_heartbeat),
    runtime_agents: r.runtime_agents_json
      ? (JSON.parse(r.runtime_agents_json) as Array<{ id: string }>)
      : [],
    budget_credits: r.budget_credits,
    budget_period: r.budget_period ?? "monthly",
    budget_used: r.budget_used ?? 0,
    budget_reset_at: r.budget_reset_at,
  }));

  return c.json({ agents });
});

// PUT /api/v1/agents/:id/budget — update an agent's per-period budget.
//
// Phase 0 plumbing only — the (closed-source) billing plugin reads these
// values at enforcement time; the platform just stores them. Owner-only
// because budgets are personal. Resetting `budget_used` to 0 whenever the
// period changes prevents a stale balance from a previous one-time / month
// from being misapplied under the new period.
agentRoutes.put("/:id/budget", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const id = c.req.param("id");
  const owns = await c.env.DB.prepare(
    "SELECT id, budget_period FROM agent_member WHERE id = ? AND user_id = ?",
  ).bind(id, userId).first<{ id: string; budget_period: string | null }>();
  if (!owns) return c.json({ error: "not found" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as {
    budget_credits?: number | null;
    budget_period?: string;
  };

  // budget_credits=null/undefined ⇒ unlimited. Anything ≥0 is honored;
  // negatives are nonsense and rejected.
  let credits: number | null = null;
  if (body.budget_credits != null) {
    if (!Number.isFinite(body.budget_credits) || body.budget_credits < 0) {
      return c.json({ error: "budget_credits must be a non-negative integer or null" }, 400);
    }
    credits = Math.floor(body.budget_credits);
  }

  const period = body.budget_period ?? owns.budget_period ?? "monthly";
  if (!["monthly", "one-time", "unlimited"].includes(period)) {
    return c.json({ error: `budget_period must be one of: monthly, one-time, unlimited (got: ${period})` }, 400);
  }

  // Reset usage when the period changes — a fresh window starts at 0.
  const periodChanged = period !== (owns.budget_period ?? "monthly");
  const usedExpr = periodChanged ? "0" : "budget_used";

  await c.env.DB.prepare(
    `UPDATE agent_member
     SET budget_credits = ?,
         budget_period = ?,
         budget_used = ${usedExpr}
     WHERE id = ?`,
  ).bind(credits, period, id).run();

  const updated = await c.env.DB.prepare(
    "SELECT id, budget_credits, budget_period, budget_used, budget_reset_at FROM agent_member WHERE id = ?",
  ).bind(id).first<{
    id: string;
    budget_credits: number | null;
    budget_period: string | null;
    budget_used: number | null;
    budget_reset_at: number | null;
  }>();
  return c.json(updated ?? { id });
});

// POST /api/v1/agents
agentRoutes.post("/", async (c) => {
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
    `INSERT INTO agent_member
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

// DELETE /api/v1/agents/:id
agentRoutes.delete("/:id", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const id = c.req.param("id");
  const owns = await c.env.DB.prepare(
    "SELECT id FROM agent_member WHERE id = ? AND user_id = ?",
  ).bind(id, userId).first<{ id: string }>();
  if (!owns) return c.json({ error: "not found" }, 404);

  await c.env.DB.prepare("DELETE FROM agent_member WHERE id = ?").bind(id).run();
  return c.body(null, 204);
});
