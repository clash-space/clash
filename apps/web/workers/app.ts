/**
 * Cloudflare Worker entry — merges gateway proxy logic + Better Auth handler
 * + React Router SSR.
 *
 * Routing:
 *   /health                     → 200 OK
 *   /api/better-auth/*          → handled in-worker via better-auth handler
 *   /sync/*                     → api-cf (WebSocket + HTTP, DO ProjectRoom)
 *   /agents/*                   → api-cf (WebSocket, DO SupervisorAgent)
 *   /assets/*                   → api-cf (signed R2 serving)
 *   /thumbnails/*               → api-cf
 *   /upload, /upload/*          → api-cf
 *   /api/tasks/*                → api-cf
 *   /api/describe, /describe    → api-cf
 *   /api/generate/*             → api-cf
 *   /api/v1/*                   → api-cf (auth-gated, x-user-id injected)
 *   /*                          → React Router SSR
 */
import { createRequestHandler } from "react-router";
import { createAuth } from "../app/lib/auth/better-auth.server";
import { handleApi } from "../app/lib/server/api-router.server";

type CloudflareFetcher = {
  fetch: (request: Request) => Promise<Response>;
};

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  KV?: KVNamespace;
  API_CF?: CloudflareFetcher;
  API_CF_URL?: string;
  R2_BUCKET?: R2Bucket;
  BETTER_AUTH_BASE_PATH?: string;
  BETTER_AUTH_ORIGIN?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  AUTH_GOOGLE_ID?: string;
  AUTH_GOOGLE_SECRET?: string;
  ACTION_SECRET_KEY?: string;
  JWT_SECRET?: string;
  R2_BUCKET_NAME?: string;
  NODE_ENV?: string;
  SKIP_LOGIN?: string;
}

declare module "react-router" {
  interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

async function proxyToApiCf(request: Request, env: Env): Promise<Response> {
  if (!env.API_CF) {
    return new Response("api-cf service binding missing", { status: 503 });
  }
  try {
    return await env.API_CF.fetch(request);
  } catch (err) {
    console.error("[worker] api-cf proxy failure:", err);
    return new Response("api-cf unavailable", { status: 502 });
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getUserIdFromApiToken(
  request: Request,
  env: Env,
): Promise<string | null> {
  const auth = request.headers.get("authorization") ?? "";
  let token: string | null = null;
  if (auth.startsWith("Bearer clsh_")) {
    token = auth.slice(7);
  } else {
    const url = new URL(request.url);
    const q = url.searchParams.get("token");
    if (q?.startsWith("clsh_")) token = q;
  }
  if (!token) return null;
  const hash = await sha256Hex(token);
  const { results } = await env.DB.prepare(
    "SELECT user_id FROM api_token WHERE token_hash = ? LIMIT 1",
  )
    .bind(hash)
    .all();
  if (!results?.[0]) return null;
  // Fire-and-forget last_used_at
  env.DB.prepare(
    "UPDATE api_token SET last_used_at = unixepoch() WHERE token_hash = ?",
  )
    .bind(hash)
    .run()
    .catch(() => {});
  return (results[0] as { user_id: string }).user_id ?? null;
}

async function getUserIdFromBetterAuth(
  request: Request,
  env: Env,
): Promise<string | null> {
  const cookie = request.headers.get("cookie") ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  if (!cookie && !authorization) return null;
  try {
    const auth = createAuth(env);
    const session = await auth.api.getSession({
      headers: new Headers(request.headers),
    });
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    console.log(`[worker] ${request.method} ${path}`);

    if (path === "/health") {
      return new Response("OK", { status: 200 });
    }

    // TEMP bypass: raw HTML to isolate RR7 from worker.
    if (path === "/raw") {
      return new Response("<h1>raw ok</h1>", {
        headers: { "content-type": "text/html" },
      });
    }

    // Browser dev telemetry — swallow silently so it doesn't flood the SSR runner.
    if (path === "/dev-log" && request.method === "POST") {
      request.body?.getReader().read().catch(() => {});
      return new Response(null, { status: 204 });
    }

    // Fast-fail /sync and /agents if the service binding is absent. These
    // paths must go to api-cf DOs and HTTP fallback doesn't help (WebSockets
    // can't round-trip via fetch across local workerd processes anyway).
    if (
      (path.startsWith("/sync/") || path.startsWith("/agents/")) &&
      !env.API_CF
    ) {
      return new Response("api-cf service binding missing", { status: 503 });
    }

    // Better Auth handler (mounted directly in the worker — playheads pattern)
    if (path.startsWith("/api/better-auth/")) {
      const auth = createAuth(env);
      return auth.handler(request);
    }

    // Pass-through to api-cf
    if (
      path === "/upload" ||
      path.startsWith("/upload/") ||
      path.startsWith("/assets/") ||
      path.startsWith("/thumbnails/") ||
      path.startsWith("/sync/") ||
      path.startsWith("/agents/") ||
      path.startsWith("/api/tasks/") ||
      path.startsWith("/api/describe") ||
      path.startsWith("/api/generate/")
    ) {
      return proxyToApiCf(request, env);
    }

    // Auth-gated public REST API v1
    if (path.startsWith("/api/v1/")) {
      const userId =
        (await getUserIdFromApiToken(request, env)) ??
        (await getUserIdFromBetterAuth(request, env));
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const proxied = new Request(request);
      proxied.headers.set("x-user-id", userId);
      return proxyToApiCf(proxied, env);
    }

    // In-worker /api/* (projects, settings, marketplace, internal).
    // SPA mode means RR7 resource routes don't run server-side, so we
    // dispatch directly here. The same .server.ts helpers power this and
    // the api.*.ts resource routes (unused while ssr:false).
    if (path.startsWith("/api/")) {
      const handled = await handleApi(request, env);
      if (handled) return handled;
    }

    console.log(`[worker] → RR7 for ${path}`);
    try {
      const res = await requestHandler(request, { cloudflare: { env, ctx } });
      console.log(`[worker] ← RR7 ${res.status} for ${path}`);
      return res;
    } catch (err) {
      console.error(`[worker] RR7 threw for ${path}:`, err);
      return new Response(`RR7 error: ${err}`, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
