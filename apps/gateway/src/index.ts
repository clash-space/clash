/**
 * Auth Gateway - API Gateway Pattern
 *
 * Single entry point for all services:
 * - /health       → Health check (public)
 * - /assets/*     → R2 assets via api-cf (public)
 * - /sync/*       → api-cf ProjectRoom DO (Loro CRDT sync, auth required)
 * - /agents/*     → api-cf ProjectRoom DO (AI chat, auth required)
 * - /api/tasks/*  → api-cf REST routes
 * - /api/describe → api-cf REST routes
 * - /upload/*     → api-cf asset upload
 * - /*            → Frontend (public)
 */

import type { Env } from "./types";
import { assertProjectOwner, getUserIdFromApiToken, getUserIdFromBetterAuth } from "./auth";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function proxyToApiCf(request: Request, env: Env): Promise<Response> {
  try {
    if (env.API_CF) {
      return await env.API_CF.fetch(request);
    }
    if (env.API_CF_URL) {
      const url = new URL(request.url);
      const fallbackUrl = new URL(url.pathname + url.search, env.API_CF_URL);
      const headers = new Headers(request.headers);
      headers.delete("host");
      return await fetch(new Request(fallbackUrl.toString(), {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
      }));
    }
    return json({ error: "API_CF service not configured" }, 500);
  } catch {
    return json({ error: "API_CF unavailable (starting up?)" }, 502);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // === Public Routes ===

    if (path === "/health") {
      return new Response("OK", { status: 200 });
    }

    // Assets: /assets/* -> api-cf
    if (path.startsWith("/assets/")) {
      return proxyToApiCf(request, env);
    }

    // Thumbnails: /thumbnails/* -> api-cf
    if (path.startsWith("/thumbnails/")) {
      return proxyToApiCf(request, env);
    }

    // === Authenticated Routes ===

    // WebSocket Sync: /sync/:projectId -> api-cf ProjectRoom DO
    if (path.startsWith("/sync/")) {
      return proxyToApiCf(request, env);
    }

    // SupervisorAgent WebSocket: /agents/:agentType/:projectId -> api-cf ProjectRoom DO
    if (path.startsWith("/agents/")) {
      return proxyToApiCf(request, env);
    }

    // Public REST API v1: /api/v1/* → api-cf (dual auth: API token + session)
    if (path.startsWith("/api/v1/")) {
      const userId =
        (await getUserIdFromApiToken(request, env)) ??
        (await getUserIdFromBetterAuth(request, env));
      if (!userId) return json({ error: "Unauthorized" }, 401);

      // Inject user ID for downstream handlers
      const proxied = new Request(request);
      proxied.headers.set("x-user-id", userId);
      return proxyToApiCf(proxied, env);
    }

    // api-cf routes: /api/tasks/*, /api/describe, /api/generate/*
    if (
      path.startsWith("/api/tasks/") ||
      path.startsWith("/api/describe") ||
      path.startsWith("/api/generate/")
    ) {
      return proxyToApiCf(request, env);
    }

    // Upload: /upload/* -> api-cf
    if (path.startsWith("/upload/") || path === "/upload") {
      return proxyToApiCf(request, env);
    }

    // === Frontend (fallback) ===

    try {
      if (env.FRONTEND) {
        return await env.FRONTEND.fetch(request);
      }

      if (env.FRONTEND_URL) {
        const upstreamUrl = new URL(env.FRONTEND_URL);
        upstreamUrl.pathname = path;
        upstreamUrl.search = url.search;

        const headers = new Headers(request.headers);
        const originalHost = headers.get("host") || url.host;
        headers.delete("host");
        headers.set("x-forwarded-host", originalHost);

        const upstreamRequest = new Request(upstreamUrl.toString(), {
          method: request.method,
          headers,
          body: request.body,
          redirect: "manual",
        });

        return await fetch(upstreamRequest);
      }

      return new Response("Frontend not configured", { status: 500 });
    } catch {
      return new Response("Frontend unavailable (starting up?)", { status: 502 });
    }
  },
};
