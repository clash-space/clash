import type { Env } from "./types";

type BetterAuthGetSessionResponse =
  | {
      session: unknown;
      user: { id: string } & Record<string, unknown>;
    }
  | null;

/**
 * SHA-256 hash a string, returning hex.
 */
async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Authenticate via API token (clsh_*). Returns userId or null.
 * Checks Authorization header first, then ?token= query param (for WebSocket).
 */
export async function getUserIdFromApiToken(request: Request, env: Env): Promise<string | null> {
  let token: string | null = null;

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader.startsWith("Bearer clsh_")) {
    token = authHeader.slice(7); // strip "Bearer "
  }

  if (!token) {
    const url = new URL(request.url);
    const queryToken = url.searchParams.get("token");
    if (queryToken?.startsWith("clsh_")) {
      token = queryToken;
    }
  }

  if (!token) return null;
  const hash = await sha256(token);
  const { results } = await env.DB.prepare(
    "SELECT user_id FROM api_token WHERE token_hash = ? LIMIT 1"
  ).bind(hash).all();

  if (!results?.[0]) return null;
  const userId = (results[0] as any).user_id as string;

  // Fire-and-forget: update last_used_at
  env.DB.prepare("UPDATE api_token SET last_used_at = unixepoch() WHERE token_hash = ?").bind(hash).run();

  return userId;
}

export async function getUserIdFromBetterAuth(request: Request, env: Env): Promise<string | null> {
  const cookie = request.headers.get("cookie") ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  if (!cookie && !authorization) return null;

  const origin = env.BETTER_AUTH_ORIGIN ?? new URL(request.url).origin;
  const basePath = env.BETTER_AUTH_BASE_PATH ?? "/api/better-auth";
  const sessionUrl = new URL(`${origin}${basePath}/get-session`);

  const res = await fetch(sessionUrl.toString(), {
    method: "GET",
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(authorization ? { authorization } : {}),
      accept: "application/json",
    },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as unknown as BetterAuthGetSessionResponse;
  return data?.user?.id ?? null;
}

export async function assertProjectOwner(env: Env, projectId: string, userId: string): Promise<void> {
  const { results } = await env.DB.prepare("SELECT owner_id FROM project WHERE id = ? LIMIT 1")
    .bind(projectId)
    .all();

  const ownerId = (results?.[0] as any)?.owner_id as string | null | undefined;
  if (!ownerId || ownerId !== userId) {
    throw new Error("Forbidden");
  }
}

