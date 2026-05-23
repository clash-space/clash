import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { DEV_USER_ID } from "./session";
import type { D1Database, DurableObjectNamespace } from "@cloudflare/workers-types";
import { projects, assets } from "../db/app.schema";
import type { ProjectWithAssets } from "@clash/web-ui/lib/types";
import { signAssetPath } from "./asset-signing";

type ApiFetcher = { fetch: (request: Request | string) => Promise<Response> };
interface Env {
  DB: D1Database;
  // ROOM is the ProjectRoom DO binding. When the same Worker that hosts the
  // DO is serving /api/projects (e.g. api-cf-hosted), call the DO directly —
  // no service binding or public URL needed.
  ROOM?: DurableObjectNamespace;
  API_CF?: ApiFetcher;
  API_CF_URL?: string;
  NODE_ENV?: string;
  JWT_SECRET?: string;
}

async function ensureDevUser(db: ReturnType<typeof getDb>, env: Env) {
  if (env.NODE_ENV !== "development") return;
  await db.run(
    sql`INSERT OR IGNORE INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (${DEV_USER_ID}, ${"Dev User"}, ${"dev@local"}, ${0}, ${Date.now()}, ${Date.now()})`,
  );
}

async function fetchNodes(env: Env, projectId: string): Promise<unknown[]> {
  const path = `/sync/${projectId}/nodes`;
  // Prefer the in-process DO binding when available — works on the hosted
  // Worker which has no API_CF service binding or API_CF_URL set, and avoids
  // a hairpin over the public internet when it does. Surface errors instead
  // of silently returning [] so a broken thumbnail pipeline is visible in
  // wrangler tail rather than masquerading as "project has no assets".
  if (env.ROOM) {
    try {
      const id = env.ROOM.idFromName(projectId);
      const res = await env.ROOM.get(id).fetch(`https://room${path}`);
      if (res.ok) return (await res.json()) as unknown[];
      console.warn(`[projects-d1] ROOM /nodes ${projectId} -> ${res.status}`);
    } catch (err) {
      console.warn(`[projects-d1] ROOM /nodes ${projectId} threw`, err);
    }
  }
  if (env.API_CF) {
    try {
      const res = await env.API_CF.fetch(`https://api-cf${path}`);
      if (res.ok) return (await res.json()) as unknown[];
      console.warn(`[projects-d1] API_CF /nodes ${projectId} -> ${res.status}`);
    } catch (err) {
      console.warn(`[projects-d1] API_CF /nodes ${projectId} threw`, err);
    }
  } else if (env.API_CF_URL) {
    try {
      const res = await fetch(`${env.API_CF_URL}${path}`);
      if (res.ok) return (await res.json()) as unknown[];
      console.warn(`[projects-d1] API_CF_URL /nodes ${projectId} -> ${res.status}`);
    } catch (err) {
      console.warn(`[projects-d1] API_CF_URL /nodes ${projectId} threw`, err);
    }
  }
  return [];
}

export async function listProjectsWithAssets(
  env: Env,
  userId: string,
  limit = 10,
): Promise<ProjectWithAssets[]> {
  const db = getDb(env.DB);
  if (userId === DEV_USER_ID) await ensureDevUser(db, env);

  const projectsData = await db.query.projects.findMany({
    where: eq(projects.ownerId, userId),
    orderBy: [desc(projects.createdAt)],
    limit,
  });

  return Promise.all(
    projectsData.map(async (project) => {
      const nodes = await fetchNodes(env, project.id);
      const mediaNodes = (nodes as any[]).filter(
        (node) =>
          (node.type === "image" || node.type === "video") &&
          typeof node.data?.assetId === "string",
      );
      const assetIds = Array.from(
        new Set(mediaNodes.map((n: any) => n.data.assetId as string)),
      );
      const assetRows = assetIds.length
        ? await db
            .select({
              id: assets.id,
              srcR2Key: assets.srcR2Key,
              coverR2Key: assets.coverR2Key,
            })
            .from(assets)
            .where(inArray(assets.id, assetIds))
        : [];
      const assetById = new Map(assetRows.map((r) => [r.id, r]));

      const projectAssets = await Promise.all(
        mediaNodes.map(async (node: any) => {
          const row = assetById.get(node.data.assetId);
          if (!row) return null;
          if (node.type === "video" && !row.coverR2Key) return null;
          const r2Key = node.type === "video" ? row.coverR2Key! : row.srcR2Key;
          return {
            id: node.id,
            url: await signAssetPath(env, r2Key),
            type: node.type as "image" | "video",
            storageKey: row.srcR2Key,
            createdAt: (() => {
              if (node.data?.createdAt) return new Date(node.data.createdAt);
              if (node.createdAt) return new Date(node.createdAt);
              return project.updatedAt || project.createdAt;
            })(),
          };
        }),
      ).then((arr) => arr.filter((a): a is NonNullable<typeof a> => a !== null));

      return { ...project, assets: projectAssets };
    }),
  );
}

export async function getProjectById(
  env: Env,
  userId: string,
  id: string,
) {
  const db = getDb(env.DB);
  if (userId === DEV_USER_ID) await ensureDevUser(db, env);
  return db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.ownerId, userId)),
  });
}

export async function createNewProject(
  env: Env,
  userId: string,
  prompt: string,
) {
  const db = getDb(env.DB);
  if (userId === DEV_USER_ID) await ensureDevUser(db, env);
  const [project] = await db
    .insert(projects)
    .values({
      ownerId: userId,
      name: prompt.length > 20 ? prompt.substring(0, 20) + "..." : prompt,
      description: prompt,
    })
    .returning();
  return project;
}

export async function renameProject(
  env: Env,
  userId: string,
  id: string,
  name: string,
) {
  const db = getDb(env.DB);
  if (userId === DEV_USER_ID) await ensureDevUser(db, env);
  await db
    .update(projects)
    .set({ name })
    .where(and(eq(projects.id, id), eq(projects.ownerId, userId)));
}

export async function removeProject(
  env: Env,
  userId: string,
  id: string,
) {
  const db = getDb(env.DB);
  if (userId === DEV_USER_ID) await ensureDevUser(db, env);
  await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.ownerId, userId)));
}
