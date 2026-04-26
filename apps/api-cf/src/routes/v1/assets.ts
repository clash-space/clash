/**
 * Assets API — user-facing CRUD for the assets metadata table.
 *
 * Auth: x-user-id header (set by auth-gateway).
 * Write paths verify project ownership before mutating.
 *
 * Routes:
 *   POST   /api/v1/assets               → create asset row + initial asset_refs
 *   GET    /api/v1/assets/:id           → fetch metadata
 *   PATCH  /api/v1/assets/:id/cover     → set cover_r2_key (system-flavored, but kept here for now)
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../config";
import { AssetKindSchema } from "@clash/shared-types/assets";
import { createAsset, getAssetById, getAssetsByIds, removeAssetRef, updateAssetCover } from "../../services/assets";
import { probeAsset } from "../../services/asset-probe";
import { SIGNED_URL_TTL, computeSignature, getSigningKey } from "../../services/asset-signing";
import { log } from "../../logger";
import type { AssetRecord } from "../../services/assets";

export const assetsRoutes = new Hono<{ Bindings: Env }>();

function getUserId(c: { req: { header: (n: string) => string | undefined } }): string {
  const userId = c.req.header("x-user-id");
  if (!userId) throw new Error("Missing x-user-id header");
  return userId;
}

async function assertProjectOwner(env: Env, projectId: string, userId: string): Promise<void> {
  const row = await env.DB
    .prepare(`SELECT owner_id as ownerId FROM project WHERE id = ?`)
    .bind(projectId)
    .first<{ ownerId: string }>();
  if (!row) throw new Error(`Project ${projectId} not found`);
  if (row.ownerId !== userId) throw new Error(`Project ${projectId} not owned by user`);
}

async function attachSignedUrlsWithKey(asset: AssetRecord, key: CryptoKey, exp: number): Promise<AssetRecord & {
  signedUrl: string;
  signedUrlExp: number;
  signedCoverUrl?: string;
  signedCoverUrlExp?: number;
}> {
  const sign = async (storageKey: string) =>
    `/assets/${storageKey}?exp=${exp}&sig=${await computeSignature(key, storageKey, exp)}`;

  return {
    ...asset,
    signedUrl: await sign(asset.srcR2Key),
    signedUrlExp: exp,
    ...(asset.coverR2Key
      ? {
          signedCoverUrl: await sign(asset.coverR2Key),
          signedCoverUrlExp: exp,
        }
      : {}),
  };
}

async function attachSignedUrls(env: Env, asset: AssetRecord) {
  const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL;
  const key = await getSigningKey(env);
  return attachSignedUrlsWithKey(asset, key, exp);
}

// ─── Schemas ────────────────────────────────────────────────

const CreateAssetSchema = z.object({
  projectId: z.string().min(1),
  kind: AssetKindSchema,
  srcR2Key: z.string().min(1),
  sourceModel: z.string().optional(),
  sourcePrompt: z.string().optional(),
  /** Override id — useful for deterministic re-create on retry. */
  id: z.string().optional(),
});

const PatchCoverSchema = z.object({
  coverR2Key: z.string().min(1),
});

const BatchAssetsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});

// ─── Routes ─────────────────────────────────────────────────

/** POST /api/v1/assets — create asset row + register reference for the project.
 *
 *  Metadata is server-probed from the R2 object by `probeAsset`; clients do
 *  NOT supply width/height/durationMs/waveform/bytes. */
assetsRoutes.post("/", async (c) => {
  try {
    const userId = getUserId(c);
    const body = CreateAssetSchema.parse(await c.req.json());
    await assertProjectOwner(c.env, body.projectId, userId);

    const { metadata, coverR2Key } = await probeAsset(
      c.env,
      body.kind,
      body.srcR2Key,
      body.projectId,
    );

    const { id } = await createAsset(c.env.DB, {
      ...body,
      userId,
      metadata,
      coverR2Key,
    });
    log.info("POST /assets created", {
      id,
      kind: body.kind,
      hasMetadata: Object.keys(metadata).length > 0,
      hasCover: !!coverR2Key,
    });
    return c.json({ id });
  } catch (e) {
    log.warn("POST /assets failed", { error: String(e) });
    return c.json({ error: String(e) }, 400);
  }
});

/** POST /api/v1/assets/batch — fetch many asset rows in one D1 round-trip. */
assetsRoutes.post("/batch", async (c) => {
  try {
    const userId = getUserId(c);
    const body = BatchAssetsSchema.parse(await c.req.json());
    const assets = await getAssetsByIds(c.env.DB, body.ids, userId);
    const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL;
    const key = await getSigningKey(c.env);
    return c.json({ assets: await Promise.all(assets.map((asset) => attachSignedUrlsWithKey(asset, key, exp))) });
  } catch (e) {
    log.warn("POST /assets/batch failed", { error: String(e) });
    return c.json({ error: String(e) }, 400);
  }
});

/** GET /api/v1/assets/:id — fetch metadata. Owner-only. */
assetsRoutes.get("/:id", async (c) => {
  try {
    const userId = getUserId(c);
    const asset = await getAssetById(c.env.DB, c.req.param("id"));
    if (!asset) return c.json({ error: "not found" }, 404);
    if (asset.userId !== userId) return c.json({ error: "forbidden" }, 403);
    return c.json(await attachSignedUrls(c.env, asset));
  } catch (e) {
    log.warn("GET /assets/:id failed", { error: String(e) });
    return c.json({ error: String(e) }, 400);
  }
});

/** DELETE /api/v1/assets/:id/ref?projectId=xxx — drop the (asset, project) reference row.
 *  R2 blob and assets row stay; mark-and-sweep GC reclaims them later if no project still references. */
assetsRoutes.delete("/:id/ref", async (c) => {
  try {
    const userId = getUserId(c);
    const projectId = c.req.query("projectId");
    if (!projectId) return c.json({ error: "projectId required" }, 400);
    await assertProjectOwner(c.env, projectId, userId);
    await removeAssetRef(c.env.DB, c.req.param("id"), projectId);
    return c.json({ ok: true });
  } catch (e) {
    log.warn("DELETE /assets/:id/ref failed", { error: String(e) });
    return c.json({ error: String(e) }, 400);
  }
});

/** PATCH /api/v1/assets/:id/cover — set cover_r2_key (used by VideoNode thumbnail capture). */
assetsRoutes.patch("/:id/cover", async (c) => {
  try {
    const userId = getUserId(c);
    const id = c.req.param("id");
    const asset = await getAssetById(c.env.DB, id);
    if (!asset) return c.json({ error: "not found" }, 404);
    if (asset.userId !== userId) return c.json({ error: "forbidden" }, 403);

    const body = PatchCoverSchema.parse(await c.req.json());
    await updateAssetCover(c.env.DB, id, body.coverR2Key);
    return c.json({ ok: true });
  } catch (e) {
    log.warn("PATCH /assets/:id/cover failed", { error: String(e) });
    return c.json({ error: String(e) }, 400);
  }
});
