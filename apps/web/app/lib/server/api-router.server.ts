/**
 * Handler for /api/* routes that live in this worker (not proxied to api-cf).
 *
 * In SPA mode, RR7 resource routes don't run server-side — so instead of
 * coupling to the RR7 request handler, we dispatch /api/* directly from the
 * worker entry. The server-side logic lives in `.server.ts` helpers that are
 * also imported from api.*.ts resource routes (so switching back to SSR keeps
 * working without refactor).
 */
import { eq } from "drizzle-orm";
import type { D1Database } from "@cloudflare/workers-types";
import { getDb } from "../db.server";
import { projects } from "../db/schema";
import { getUserIdFromRequest, getUserIdOrDev } from "../auth/session.server";
import {
  createNewProject,
  getProjectById,
  listProjectsWithAssets,
  removeProject,
  renameProject,
} from "./projects.server";
import {
  createApiToken,
  deleteVariable,
  installAction,
  installSkill,
  listApiTokens,
  listInstalledActions,
  listInstalledSkills,
  listVariables,
  revokeApiToken,
  setVariable,
  uninstallAction,
  uninstallSkill,
} from "./settings.server";

const REGISTRY_URL =
  "https://raw.githubusercontent.com/clash-community/awesome-actions/main/registry.json";

export interface ApiEnv {
  DB: D1Database;
  NODE_ENV?: string;
  SKIP_LOGIN?: string;
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_SECRET?: string;
  AUTH_SECRET?: string;
  AUTH_GOOGLE_ID?: string;
  AUTH_GOOGLE_SECRET?: string;
  ACTION_SECRET_KEY?: string;
  API_CF?: unknown;
  API_CF_URL?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function readJson<T = unknown>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

function assertMethod(request: Request, ...allowed: string[]): Response | null {
  if (!allowed.includes(request.method)) {
    return json({ error: "Method not allowed" }, 405);
  }
  return null;
}

async function requireUser(
  request: Request,
  env: ApiEnv,
): Promise<string | Response> {
  try {
    return await getUserIdOrDev(request, env as any);
  } catch (res) {
    if (res instanceof Response) return res;
    return json({ error: "Unauthorized" }, 401);
  }
}

async function optionalUser(
  request: Request,
  env: ApiEnv,
): Promise<string | null> {
  return getUserIdFromRequest(request, env as any).catch(() => null);
}

/**
 * Dispatch /api/* that we own (not proxied to api-cf). Returns null if the
 * path is not ours so the caller can continue routing.
 */
export async function handleApi(
  request: Request,
  env: ApiEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  // ───── /api/projects ─────
  if (path === "/api/projects") {
    if (request.method === "GET") {
      const userId = await optionalUser(request, env);
      if (!userId) return json({ error: "Unauthorized" }, 401);
      return json(await listProjectsWithAssets(env as any, userId, 100));
    }
    if (request.method === "POST") {
      const userOrRes = await requireUser(request, env);
      if (userOrRes instanceof Response) return userOrRes;
      const { prompt } = await readJson<{ prompt?: string }>(request);
      if (!prompt) return json({ error: "Missing prompt" }, 400);
      const p = await createNewProject(env as any, userOrRes, prompt);
      return json({ id: p.id });
    }
    return assertMethod(request, "GET", "POST")!;
  }

  // ───── /api/projects/:id ─────
  const projMatch = path.match(/^\/api\/projects\/([^/]+)$/);
  if (projMatch) {
    const id = projMatch[1];
    const userOrRes = await requireUser(request, env);
    if (userOrRes instanceof Response) return userOrRes;
    if (request.method === "GET") {
      const p = await getProjectById(env as any, userOrRes, id);
      if (!p) return json({ error: "Not found" }, 404);
      return json(p);
    }
    if (request.method === "PATCH") {
      const { name } = await readJson<{ name?: string }>(request);
      if (!name) return json({ error: "Missing name" }, 400);
      await renameProject(env as any, userOrRes, id, name);
      return json({ ok: true });
    }
    if (request.method === "DELETE") {
      await removeProject(env as any, userOrRes, id);
      return new Response(null, { status: 204 });
    }
    return assertMethod(request, "GET", "PATCH", "DELETE")!;
  }

  // ───── /api/internal/projects/:projectId/context ─────
  const ctxMatch = path.match(
    /^\/api\/internal\/projects\/([^/]+)\/context$/,
  );
  if (ctxMatch) {
    if (request.method !== "GET") return assertMethod(request, "GET")!;
    const userId = await optionalUser(request, env);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    const db = getDb(env.DB);
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, ctxMatch[1]),
    });
    if (!project) return json({ error: "Not found" }, 404);
    if (project.ownerId !== userId) return json({ error: "Forbidden" }, 403);
    return json({ nodes: [], edges: [] });
  }

  // ───── /api/settings/tokens{,/:id} ─────
  if (path === "/api/settings/tokens") {
    const userOrRes = await requireUser(request, env);
    if (userOrRes instanceof Response) return userOrRes;
    if (request.method === "GET") {
      return json(await listApiTokens(env as any, userOrRes));
    }
    if (request.method === "POST") {
      const { name } = await readJson<{ name?: string }>(request);
      return json(await createApiToken(env as any, userOrRes, name ?? ""));
    }
    return assertMethod(request, "GET", "POST")!;
  }
  const tokenMatch = path.match(/^\/api\/settings\/tokens\/([^/]+)$/);
  if (tokenMatch) {
    if (request.method !== "DELETE") return assertMethod(request, "DELETE")!;
    const userOrRes = await requireUser(request, env);
    if (userOrRes instanceof Response) return userOrRes;
    await revokeApiToken(env as any, userOrRes, tokenMatch[1]);
    return new Response(null, { status: 204 });
  }

  // ───── /api/settings/variables{,/:id} ─────
  if (path === "/api/settings/variables") {
    const userOrRes = await requireUser(request, env);
    if (userOrRes instanceof Response) return userOrRes;
    if (request.method === "GET") {
      return json(await listVariables(env as any, userOrRes));
    }
    if (request.method === "POST") {
      const { key, value } = await readJson<{ key?: string; value?: string }>(
        request,
      );
      if (!key || typeof value !== "string") {
        return json({ error: "Missing key/value" }, 400);
      }
      return json(await setVariable(env as any, userOrRes, key, value));
    }
    return assertMethod(request, "GET", "POST")!;
  }
  const varMatch = path.match(/^\/api\/settings\/variables\/([^/]+)$/);
  if (varMatch) {
    if (request.method !== "DELETE") return assertMethod(request, "DELETE")!;
    const userOrRes = await requireUser(request, env);
    if (userOrRes instanceof Response) return userOrRes;
    await deleteVariable(env as any, userOrRes, varMatch[1]);
    return new Response(null, { status: 204 });
  }

  // ───── /api/settings/actions{,/:id} ─────
  if (path === "/api/settings/actions") {
    const userOrRes = await requireUser(request, env);
    if (userOrRes instanceof Response) return userOrRes;
    if (request.method === "GET") {
      return json(await listInstalledActions(env as any, userOrRes));
    }
    if (request.method === "POST") {
      const body = await readJson<{ manifest?: Record<string, any> }>(request);
      if (!body.manifest) return json({ error: "Missing manifest" }, 400);
      return json(await installAction(env as any, userOrRes, body.manifest));
    }
    return assertMethod(request, "GET", "POST")!;
  }
  const actMatch = path.match(/^\/api\/settings\/actions\/([^/]+)$/);
  if (actMatch) {
    if (request.method !== "DELETE") return assertMethod(request, "DELETE")!;
    const userOrRes = await requireUser(request, env);
    if (userOrRes instanceof Response) return userOrRes;
    await uninstallAction(env as any, userOrRes, decodeURIComponent(actMatch[1]));
    return new Response(null, { status: 204 });
  }

  // ───── /api/settings/skills{,/:id} ─────
  if (path === "/api/settings/skills") {
    const userOrRes = await requireUser(request, env);
    if (userOrRes instanceof Response) return userOrRes;
    if (request.method === "GET") {
      return json(await listInstalledSkills(env as any, userOrRes));
    }
    if (request.method === "POST") {
      const body = await readJson<{ skill?: Record<string, any> }>(request);
      if (!body.skill) return json({ error: "Missing skill" }, 400);
      return json(await installSkill(env as any, userOrRes, body.skill));
    }
    return assertMethod(request, "GET", "POST")!;
  }
  const skillMatch = path.match(/^\/api\/settings\/skills\/([^/]+)$/);
  if (skillMatch) {
    if (request.method !== "DELETE") return assertMethod(request, "DELETE")!;
    const userOrRes = await requireUser(request, env);
    if (userOrRes instanceof Response) return userOrRes;
    await uninstallSkill(env as any, userOrRes, decodeURIComponent(skillMatch[1]));
    return new Response(null, { status: 204 });
  }

  // ───── /api/marketplace/registry ─────
  if (path === "/api/marketplace/registry") {
    if (request.method !== "GET") return assertMethod(request, "GET")!;
    try {
      const res = await fetch(REGISTRY_URL);
      if (!res.ok) return json({ version: 1, actions: [], skills: [] });
      return json(await res.json());
    } catch {
      return json({ version: 1, actions: [], skills: [] });
    }
  }

  return null;
}
