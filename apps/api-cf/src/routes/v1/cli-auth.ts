import { Hono } from "hono";
import type { Env } from "../../config";

export const cliAuthRoutes = new Hono<{ Bindings: Env }>();

function generateToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `clsh_${hex}`;
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// POST /api/v1/cli-auth — generate API token for CLI OAuth flow
cliAuthRoutes.post("/", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{ tokenName?: string }>().catch(() => ({}));
  const tokenName = body.tokenName || "CLI Login";

  const plaintext = generateToken();
  const hash = await sha256(plaintext);
  const prefix = plaintext.slice(0, 13) + "...";
  const id = crypto.randomUUID();

  await c.env.DB.prepare(
    "INSERT INTO api_token (id, user_id, name, token_hash, token_prefix, created_at) VALUES (?, ?, ?, ?, ?, unixepoch())"
  ).bind(id, userId, tokenName, hash, prefix).run();

  return c.json({ token: plaintext });
});
