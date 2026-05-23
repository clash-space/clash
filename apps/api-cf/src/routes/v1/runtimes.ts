/**
 * Runtime registry and onboarding routes — split across two trust boundaries:
 *
 *   /api/v1/runtimes/*    browser, gateway requires user auth
 *     POST /connect-daemon    → one-time code (5-min TTL)
 *     GET  /                  → list my runtimes
 *     DELETE /:id             → revoke a runtime + its tokens
 *
 *   /agents/runtime/*     daemon, gateway proxies through (auth is in body/header)
 *     POST /exchange          → { code, machine_id, … } → { runtime_id, token }
 *
 * Setup flow:
 *   1. CLI binds 127.0.0.1:<rand-port>, opens browser to
 *      `https://clash.video/connect-daemon?cb=…&state=…`
 *   2. Browser (auth'd via Better Auth cookie) POSTs `/api/v1/runtimes/connect-daemon`
 *      with the state echo → gets back a one-time `code`.
 *   3. Browser redirects to `http://127.0.0.1:<port>/cb?code=…&state=…`.
 *      Localhost server is the CLI; it grabs the code and closes.
 *   4. CLI POSTs `/agents/runtime/exchange` with `{ code, machine_id, hostname, os, version }`.
 *      Server validates code, inserts `runtime` row + `runtime_token` row,
 *      returns the token plaintext (only time it's ever transmitted).
 *   5. CLI writes ~/.config/clash/credentials.json + installs launchd plist.
 */

import { Hono } from "hono";
import type { Env } from "../../config";
import { deriveRuntimeStatus } from "../../lib/runtime-status";

/** Browser-facing routes — mounted under /api/v1/runtimes. */
export const runtimesRoutes = new Hono<{ Bindings: Env }>();

/** Daemon-facing routes — mounted under /agents/runtime. */
export const runtimeDaemonRoutes = new Hono<{ Bindings: Env }>();

const CODE_TTL_SECONDS = 5 * 60;

function generateCode(): string {
  // 16 bytes of entropy → 32 hex chars. Lives 5 min, single-use, doesn't
  // need to be human-typeable.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateRuntimeToken(): string {
  // sk_machine_ + 60 hex (240 bits). Stripe-style prefix so it's grep-able
  // in user shell history if it ever leaks (clear what kind of secret it is).
  const bytes = new Uint8Array(30);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sk_machine_${hex}`;
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// POST /connect-daemon — browser asks for a one-time exchange code.
// Auth: x-user-id (filled by middleware from Better Auth cookie).
runtimesRoutes.post("/connect-daemon", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const body = (await c.req.json().catch(() => ({}))) as { state?: string };
  const state = body.state;
  if (!state || typeof state !== "string" || state.length < 8) {
    return c.json({ error: "state required (>= 8 chars)" }, 400);
  }

  const code = generateCode();
  const expiresAt = Math.floor(Date.now() / 1000) + CODE_TTL_SECONDS;

  await c.env.DB.prepare(
    "INSERT INTO connect_daemon_code (code, user_id, state, expires_at) VALUES (?, ?, ?, ?)",
  ).bind(code, userId, state, expiresAt).run();

  return c.json({ code, expires_at: expiresAt });
});

// POST /exchange — daemon exchanges code for a runtime token.
// Mounted at /agents/runtime/exchange (outside the user-auth gateway).
// No auth header — the code is the credential.
runtimeDaemonRoutes.post("/exchange", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    code?: string;
    state?: string;
    machine_id?: string;
    hostname?: string;
    os?: string;
    version?: string;
  };

  const { code, state, machine_id, hostname, os, version } = body;
  if (!code || !state || !machine_id || !hostname || !os || !version) {
    return c.json({
      error: "code, state, machine_id, hostname, os, version all required",
    }, 400);
  }

  const now = Math.floor(Date.now() / 1000);

  // Validate code: exists, not used, not expired, state matches what we
  // recorded. We delete the row inline (use-once) regardless of outcome.
  const row = await c.env.DB.prepare(
    "SELECT user_id, state, expires_at, used_at FROM connect_daemon_code WHERE code = ?",
  ).bind(code).first<{ user_id: string; state: string; expires_at: number; used_at: number | null }>();

  if (!row) return c.json({ error: "invalid code" }, 400);
  if (row.used_at) return c.json({ error: "code already used" }, 400);
  if (row.expires_at < now) return c.json({ error: "code expired" }, 400);
  if (row.state !== state) return c.json({ error: "state mismatch" }, 400);

  // Mark used. Race window: two concurrent /exchange with the same code
  // would both pass the SELECT — we accept that risk because (a) browser
  // only redirects once and (b) the token returned to the loser is harmless,
  // it's a plain new credential under the same user.
  await c.env.DB.prepare(
    "UPDATE connect_daemon_code SET used_at = ? WHERE code = ?",
  ).bind(now, code).run();

  // Idempotent runtime insert: if user re-runs `clash setup` on the same
  // machine, reuse the existing runtime row instead of creating a duplicate.
  // (machine_id is the daemon-computed stable fingerprint.)
  const existing = await c.env.DB.prepare(
    "SELECT id FROM runtime WHERE owner_user_id = ? AND machine_id = ?",
  ).bind(row.user_id, machine_id).first<{ id: string }>();

  let runtimeId: string;
  if (existing) {
    runtimeId = existing.id;
    // Refresh the metadata to whatever the daemon just reported (hostname
    // change, OS upgrade, daemon version bump).
    await c.env.DB.prepare(
      "UPDATE runtime SET hostname = ?, os = ?, version = ? WHERE id = ?",
    ).bind(hostname, os, version, runtimeId).run();
  } else {
    runtimeId = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO runtime (id, owner_user_id, machine_id, hostname, os, agents_json, version, status, last_heartbeat, created_at)
       VALUES (?, ?, ?, ?, ?, '[]', ?, 'offline', NULL, ?)`,
    ).bind(runtimeId, row.user_id, machine_id, hostname, os, version, now).run();
  }

  // Always issue a fresh token. Old tokens for this runtime stay valid
  // (multiple `clash setup` runs from different shells are rare but
  // shouldn't kick each other out). User can revoke explicitly via UI.
  const tokenPlain = generateRuntimeToken();
  const tokenHash = await sha256(tokenPlain);
  const tokenId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO runtime_token (id, runtime_id, token_hash, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(tokenId, runtimeId, tokenHash, row.user_id, now).run();

  // Issue an agent-side API key alongside. The spawned ACP agent uses
  // it as `CLASH_API_KEY` so the bundled `clash` CLI / clash plugin
  // hooks can call /api/v1/* without prompting the user to log in
  // separately. Stored same way as user-created tokens (api_token row,
  // sha256 hash); daemon persists the plaintext locally in credentials.json.
  const agentApiKey = await issueAgentApiKey(c.env, row.user_id, hostname);

  return c.json({
    runtime_id: runtimeId,
    token: tokenPlain,
    agent_api_key: agentApiKey,
  });
});

/**
 * Mint a `clsh_*` API token for use by an ACP agent spawned on a runtime.
 * Same shape as user-created tokens (api_token row, sha256 hash) so the
 * existing /api/v1 auth middleware accepts it. Plaintext is returned once;
 * we never re-issue, never log it.
 */
async function issueAgentApiKey(env: Env, userId: string, displayLabel: string): Promise<string> {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const plain = `clsh_${hex}`;
  const hash = await sha256(plain);
  const id = crypto.randomUUID();
  const prefix = plain.slice(0, 13) + "...";
  await env.DB.prepare(
    "INSERT INTO api_token (id, user_id, name, token_hash, token_prefix, created_at) VALUES (?, ?, ?, ?, ?, unixepoch())",
  ).bind(id, userId, `Local agent (${displayLabel})`, hash, prefix).run();
  return plain;
}

// GET / — list user's runtimes (with derived agents array, no token).
runtimesRoutes.get("/", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const { results } = await c.env.DB.prepare(
    `SELECT id, machine_id, hostname, os, agents_json, version, status, last_heartbeat, created_at
     FROM runtime WHERE owner_user_id = ? ORDER BY created_at DESC`,
  ).bind(userId).all<{
    id: string;
    machine_id: string;
    hostname: string;
    os: string;
    agents_json: string;
    version: string;
    status: string;
    last_heartbeat: number | null;
    created_at: number;
  }>();

  return c.json({
    runtimes: (results ?? []).map((r) => ({
      id: r.id,
      machine_id: r.machine_id,
      hostname: r.hostname,
      os: r.os,
      agents: JSON.parse(r.agents_json || "[]"),
      version: r.version,
      status: deriveRuntimeStatus(r.status, r.last_heartbeat),
      last_heartbeat: r.last_heartbeat,
      created_at: r.created_at,
    })),
  });
});

// POST /:rid/sessions — start a new local-runtime chat session on a runtime.
//
// Two payload shapes (Phase 2 added crew_member_id; old crew_id kept for
// back-compat with browsers that haven't been refreshed yet):
//
//   Modern: { crew_member_id, project_id }
//     Server resolves the claimed crew_member → template_id (used for
//     daemon dispatch) and verifies crew_member.runtime_id == :rid +
//     crew_member.user_id == caller. Single source of truth — caller
//     doesn't pass template_id directly.
//
//   Legacy: { crew_id (template), project_id }
//     Used by the old GroupChatPanel before the claim layer landed.
//     Server still spawns the daemon agent, but the row's
//     crew_member_id is NULL — it has no claimed identity. Stops
//     working once we fully migrate; for now keeps refresh-during-
//     deploy from breaking.
//
// Browser then opens /api/v1/local-sessions/:sid/_stream for the
// session's event stream.
runtimesRoutes.post("/:rid/sessions", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const rid = c.req.param("rid");
  const body = (await c.req.json().catch(() => ({}))) as {
    crew_member_id?: string;
    crew_id?: string;
    project_id?: string;
    /** @deprecated kept for older browsers; prefer crew_id. */
    agent_id?: string;
    cwd?: string;
    resume_session_id?: string;
  };

  let crewId: string | null = null;            // template id sent to daemon
  let crewMemberId: string | null = null;      // null in legacy path
  let agentOverride: string | null = null;     // ACP CLI override from claim

  if (body.crew_member_id) {
    // Modern path — resolve through claim layer.
    const cm = await c.env.DB.prepare(
      "SELECT id, template_id, runtime_id, agent_id FROM crew_member WHERE id = ? AND user_id = ?",
    ).bind(body.crew_member_id, userId).first<{
      id: string; template_id: string; runtime_id: string; agent_id: string | null;
    }>();
    if (!cm) return c.json({ error: "crew member not found" }, 404);
    if (cm.runtime_id !== rid) {
      return c.json({ error: "crew member belongs to a different runtime" }, 400);
    }
    crewId = cm.template_id;
    crewMemberId = cm.id;
    agentOverride = cm.agent_id;
  } else {
    // Legacy path — accept template id directly. Soon to be removed.
    crewId = body.crew_id ?? (body.agent_id ? "director" : null);
    if (!crewId) return c.json({ error: "crew_member_id or crew_id required" }, 400);
  }

  const runtime = await c.env.DB.prepare(
    "SELECT id, status, last_heartbeat FROM runtime WHERE id = ? AND owner_user_id = ?",
  ).bind(rid, userId).first<{ id: string; status: string; last_heartbeat: number | null }>();
  if (!runtime) return c.json({ error: "runtime not found" }, 404);
  // Use the derived status so a row that's still flagged `'online'`
  // but hasn't heartbeat for 90s+ gets rejected here. Without this
  // check the browser's auto-reconnect loop pumps out orphan
  // runtime_session rows every few seconds against a dead daemon —
  // we saw 239 leak in a single afternoon before this guard landed.
  if (deriveRuntimeStatus(runtime.status, runtime.last_heartbeat) !== "online") {
    return c.json({ error: "runtime offline" }, 409);
  }

  const sessionId = crypto.randomUUID();
  // cwd column overload remains: it's still being used to hold project_id
  // (existing hack). When that's split into its own column the room
  // mention dispatcher in projects.ts will need the same change.
  await c.env.DB.prepare(
    `INSERT INTO runtime_session
       (id, user_id, runtime_id, agent_id, crew_member_id, cwd, status, created_at, last_active_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', unixepoch(), unixepoch())`,
  ).bind(sessionId, userId, rid, crewId, crewMemberId, body.project_id ?? "").run();

  const doStub = c.env.RUNTIME_ROOM.get(c.env.RUNTIME_ROOM.idFromName(rid));
  const ok = await (doStub as unknown as {
    sendToDaemon(msg: Record<string, unknown>): Promise<boolean>;
  }).sendToDaemon({
    type: "session.start",
    session_id: sessionId,
    crew_id: crewId,
    // crew_member_id forwarded so the daemon can inject it into the
    // spawned agent's env (CLASH_CREW_MEMBER_ID). The agent then uses
    // it as the sender_id when calling `clash room say`.
    ...(crewMemberId ? { crew_member_id: crewMemberId } : {}),
    // agent_id override — daemon prefers this over the bundled
    // template's runtime.json default. Lets each user pick which CLI
    // (claude-code-acp / codex / gemini / …) powers their crew.
    ...(agentOverride ? { agent_id: agentOverride } : {}),
    ...(body.project_id ? { project_id: body.project_id } : {}),
    ...(body.resume_session_id ? { resume: { acp_session_id: body.resume_session_id } } : {}),
  });

  if (!ok) {
    await c.env.DB.prepare(
      "UPDATE runtime_session SET status = 'closed' WHERE id = ?",
    ).bind(sessionId).run();
    return c.json({ error: "runtime daemon not reachable; try again" }, 503);
  }

  return c.json({ session_id: sessionId });
});

// GET /:rid/local-sessions/scan — RPC the daemon for local CC transcripts
// it can resume. Used by the runtime picker dialog so the user can pick
// "Resume X" instead of "Start fresh". Returns [] if daemon offline /
// unreachable / RPC times out.
runtimesRoutes.get("/:rid/local-sessions/scan", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const rid = c.req.param("rid");
  const runtime = await c.env.DB.prepare(
    "SELECT id, status FROM runtime WHERE id = ? AND owner_user_id = ?",
  ).bind(rid, userId).first<{ id: string; status: string }>();
  if (!runtime) return c.json({ error: "runtime not found" }, 404);
  if (runtime.status !== "online") return c.json({ sessions: [] });

  const doStub = c.env.RUNTIME_ROOM.get(c.env.RUNTIME_ROOM.idFromName(rid));
  const sessions = await (doStub as unknown as {
    listLocalSessions(timeoutMs?: number): Promise<unknown[]>;
  }).listLocalSessions(5000).catch(() => []);
  return c.json({ sessions });
});

// DELETE /:id — revoke runtime: kill all its tokens + delete runtime row.
// The daemon will get auth-rejected on next /attach and stop reconnecting
// after a few backoff cycles.
runtimesRoutes.delete("/:id", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const id = c.req.param("id");

  // Verify ownership before deleting.
  const owned = await c.env.DB.prepare(
    "SELECT id FROM runtime WHERE id = ? AND owner_user_id = ?",
  ).bind(id, userId).first<{ id: string }>();
  if (!owned) return c.json({ error: "not found" }, 404);

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE runtime_token SET revoked_at = ? WHERE runtime_id = ? AND revoked_at IS NULL").bind(now, id),
    c.env.DB.prepare("DELETE FROM runtime WHERE id = ?").bind(id),
  ]);

  return c.json({ ok: true });
});

/**
 * Helper for the WS /attach route (defined in app.ts) — validates a
 * `Authorization: Bearer sk_machine_…` header against runtime_token,
 * returns the runtime row on success.
 */
export async function authenticateRuntimeToken(
  env: Env,
  bearer: string,
): Promise<{ runtime_id: string; user_id: string } | null> {
  const token = bearer.startsWith("Bearer ") ? bearer.slice(7) : bearer;
  if (!token.startsWith("sk_machine_")) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT t.runtime_id, r.owner_user_id AS user_id
     FROM runtime_token t JOIN runtime r ON r.id = t.runtime_id
     WHERE t.token_hash = ? AND t.revoked_at IS NULL`,
  ).bind(hash).first<{ runtime_id: string; user_id: string }>();
  if (!row) return null;
  // Best-effort last_used_at refresh; don't block on it.
  env.DB.prepare("UPDATE runtime_token SET last_used_at = unixepoch() WHERE token_hash = ?")
    .bind(hash).run().catch(() => {});
  return row;
}
