/**
 * /api/v1/runtimes/* — daemon registry and onboarding.
 *
 * The setup flow is OAuth-style with a localhost callback (Wrangler / GitHub
 * CLI / Vercel all do this):
 *
 *   1. CLI binds 127.0.0.1:<rand-port>, opens browser to
 *      `https://clash.video/connect-daemon?cb=…&state=…`
 *   2. Browser (auth'd via Better Auth cookie) POSTs `/connect-daemon` with
 *      the state echo → gets back a one-time `code` (5-min TTL).
 *   3. Browser redirects to `http://127.0.0.1:<port>/cb?code=…&state=…`.
 *      Localhost server is the CLI; it grabs the code and closes.
 *   4. CLI POSTs `/exchange` with `{ code, machine_id, hostname, os, version }`.
 *      Server validates code, inserts `runtime` row + `runtime_token` row,
 *      returns the token plaintext (only time it's ever transmitted).
 *   5. CLI writes ~/.config/clash/credentials.json + installs launchd plist.
 *
 * Routes:
 *   POST /api/v1/runtimes/connect-daemon   browser, auth required → { code }
 *   POST /api/v1/runtimes/exchange         daemon, no auth (code IS auth) → { runtime_id, token }
 *   GET  /api/v1/runtimes                  browser, list my runtimes
 *   DELETE /api/v1/runtimes/:id            browser, revoke a runtime + tokens
 */

import { Hono } from "hono";
import type { Env } from "../../config";

export const runtimesRoutes = new Hono<{ Bindings: Env }>();

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
// No auth header — the code is the credential.
runtimesRoutes.post("/exchange", async (c) => {
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

  return c.json({
    runtime_id: runtimeId,
    token: tokenPlain,
  });
});

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
      status: r.status,
      last_heartbeat: r.last_heartbeat,
      created_at: r.created_at,
    })),
  });
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
