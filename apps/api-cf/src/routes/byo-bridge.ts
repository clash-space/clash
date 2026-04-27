/**
 * /agents/byo-bridge/* — pairing + WS upgrade routes for BYO local agent.
 *
 * Three endpoints:
 *   POST /agents/byo-bridge/pair         Browser asks for a fresh pairing token.
 *                                        Auth: Better Auth via x-user-id middleware.
 *   GET  /agents/byo-bridge/browser      Browser opens its half of the relay.
 *                                        Query: ?token=<pair token>
 *   GET  /agents/byo-bridge/cli          Local bridge opens its half.
 *                                        Query: ?token=<same token>
 *                                        No auth header — token IS the credential.
 *
 * Both WS upgrades route to the same DO via `idFromName(token)`. The DO
 * pairs the two sockets and relays raw frames. See agents/byo-bridge.ts.
 *
 * Token format: 32 chars from a URL-safe alphabet. The hex of 16 random
 * bytes is enough (~128 bits), but base32-uppercase is friendlier when the
 * user has to type/paste it across terminals. We chunk it as XXXX-XXXX-…
 * for human display in the dialog.
 */

import { Hono, type Context } from "hono";
import type { Env } from "../config";

export const byoBridgeRoutes = new Hono<{ Bindings: Env }>();
type Ctx = Context<{ Bindings: Env }>;

// 16 random bytes → 26 base32 chars (no padding) → 6 dash-separated chunks of ~5.
// Plenty of entropy, easy enough to copy-paste once.
function generatePairToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Crockford base32 (no I, L, O, U) — survives copy-paste better than hex.
  const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}

// POST /agents/byo-bridge/pair — return a fresh token. Auth required.
byoBridgeRoutes.post("/pair", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const token = generatePairToken();
  return c.json({
    token,
    // Suggested display: "ABCD-EFGH-…". Leaves UI free to format.
    display: token.match(/.{1,4}/g)?.join("-") ?? token,
  });
});

// WS upgrade routes — both forward to the DO addressed by token.
async function upgrade(c: Ctx, side: "browser" | "cli"): Promise<Response> {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("WebSocket only", 400);
  }
  const tokenRaw = new URL(c.req.url).searchParams.get("token");
  if (!tokenRaw) return c.text("missing token", 400);
  // Browser side uses the raw 26-char token; the user-typed CLI token has
  // dashes for human readability (XXXX-XXXX-…). Both must address the same
  // DO via idFromName, so normalize before lookup.
  const token = tokenRaw.replace(/-/g, "");

  // Forward x-user-id (set by the api-cf gateway middleware after Better Auth)
  // only on the browser side. CLI side has no Better Auth context — its
  // credential IS the token.
  const fwd = new Request(c.req.raw);
  if (side === "browser") {
    const userId = c.req.header("x-user-id");
    if (!userId) return c.text("unauthorized", 401);
    fwd.headers.set("x-user-id", userId);
  }

  const id = c.env.BYO_BRIDGE.idFromName(token);
  // Path tells the DO which side this is.
  const url = new URL(`https://internal/byo-bridge/${side}`);
  const doReq = new Request(url, { method: "GET", headers: fwd.headers });
  return c.env.BYO_BRIDGE.get(id).fetch(doReq);
}

byoBridgeRoutes.get("/browser", (c) => upgrade(c, "browser"));
byoBridgeRoutes.get("/cli", (c) => upgrade(c, "cli"));
