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

function proxyToApiCf(request: Request, env: Env): Promise<Response> | Response {
  if (env.API_CF) {
    return env.API_CF.fetch(request);
  }
  if (env.API_CF_URL) {
    const url = new URL(request.url);
    const fallbackUrl = new URL(url.pathname + url.search, env.API_CF_URL);
    const headers = new Headers(request.headers);
    headers.delete("host");
    return fetch(new Request(fallbackUrl.toString(), {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    }));
  }
  return json({ error: "API_CF service not configured" }, 500);
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
      const projectId = path.split("/")[2];
      if (!projectId) return new Response("Missing project ID", { status: 400 });

      const userId =
        (await getUserIdFromApiToken(request, env)) ??
        (await getUserIdFromBetterAuth(request, env));
      if (!userId) return new Response("Unauthorized", { status: 401 });

      try {
        await assertProjectOwner(env, projectId, userId);
      } catch {
        return new Response("Forbidden", { status: 403 });
      }

      return proxyToApiCf(request, env);
    }

    // SupervisorAgent WebSocket: /agents/:agentType/:projectId -> api-cf ProjectRoom DO
    if (path.startsWith("/agents/")) {
      const segments = path.split("/");
      const projectId = segments[3];
      if (!projectId) return new Response("Missing project ID", { status: 400 });

      const userId = await getUserIdFromBetterAuth(request, env);
      if (!userId) return json({ error: "Unauthorized" }, 401);

      try {
        await assertProjectOwner(env, projectId, userId);
      } catch {
        return new Response("Forbidden", { status: 403 });
      }

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

    if (env.FRONTEND) {
      return env.FRONTEND.fetch(request);
    }

    if (env.FRONTEND_URL) {
      const upstreamUrl = new URL(env.FRONTEND_URL);
      upstreamUrl.pathname = path;
      upstreamUrl.search = url.search;

      const headers = new Headers(request.headers);
      headers.delete("host");

      const upstreamRequest = new Request(upstreamUrl.toString(), {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
      });

      return fetch(upstreamRequest);
    }

    return new Response("Frontend not configured", { status: 500 });
  },
};
