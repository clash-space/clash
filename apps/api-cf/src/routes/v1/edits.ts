/**
 * Edits API — copy-on-write transformations of existing assets.
 *
 * Pipeline parallel to (but separate from) generation: client renders the
 * edited blob (canvas crop, video screenshot, …) and POSTs the bytes here.
 * We R2-PUT the file, probe metadata, and createAsset with a `sources`
 * lineage row pointing at the input asset (`role: 'edit-source'`).
 *
 * Why a dedicated route, not /api/v1/upload + /api/v1/assets composed?
 *   - Upload alone doesn't create a D1 row; assets POST doesn't accept a body.
 *   - Edits need a single atomic request for ownership + lineage so we don't
 *     orphan an R2 object on a half-failed two-step.
 *
 * Auth: x-user-id header. Verifies project ownership AND that the source
 * asset is owned by the same user (no cross-account derivation).
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../config";
import {
  AssetKindSchema,
  ImageEditParamsSchema,
  VideoClipParamsSchema,
  EDIT_KIND,
  type EditKind,
} from "@clash/shared-types";
import { createAsset, getAssetById } from "../../services/assets";
import { probeAsset } from "../../services/asset-probe";
import { clipVideo } from "../../services/video-clip";
import { log } from "../../logger";

export const editsRoutes = new Hono<{ Bindings: Env }>();

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

// ─── Schemas ────────────────────────────────────────────────

/**
 * editParams arrives as a JSON-encoded string in the multipart form so we
 * don't need a separate JSON channel. Different shape per editKind.
 */
const EditParamsByKind: Record<EditKind, z.ZodTypeAny> = {
  [EDIT_KIND.ImageEditor]: ImageEditParamsSchema,
  [EDIT_KIND.VideoClipper]: VideoClipParamsSchema,
};

/** Output kind we expect the client-rendered blob to be. */
const OutputKindSchema = AssetKindSchema; // 'image' | 'video' | 'audio'

// ─── Routes ─────────────────────────────────────────────────

/**
 * POST /api/v1/edits — accept a client-rendered edit blob.
 *
 * Multipart form:
 *   file:           Blob (the rendered output)
 *   projectId:      string
 *   sourceAssetId:  string  (the asset this edit derives from)
 *   editKind:       'image-editor' | 'video-clipper'
 *   outputKind:     'image' | 'video' | 'audio'
 *   editParams:     JSON-encoded params object (shape depends on editKind)
 */
editsRoutes.post("/", async (c) => {
  try {
    const userId = getUserId(c);
    const formData = await c.req.formData();
    const fileEntry = formData.get("file");
    if (!fileEntry || typeof fileEntry === "string") {
      return c.json({ error: "Missing file" }, 400);
    }
    const file = fileEntry as File;

    const projectId = String(formData.get("projectId") ?? "");
    const sourceAssetId = String(formData.get("sourceAssetId") ?? "");
    const editKindRaw = String(formData.get("editKind") ?? "");
    const outputKindRaw = String(formData.get("outputKind") ?? "");
    const editParamsRaw = String(formData.get("editParams") ?? "{}");

    if (!projectId) return c.json({ error: "Missing projectId" }, 400);
    if (!sourceAssetId) return c.json({ error: "Missing sourceAssetId" }, 400);

    const editKind = editKindRaw as EditKind;
    if (editKind !== EDIT_KIND.ImageEditor && editKind !== EDIT_KIND.VideoClipper) {
      return c.json({ error: `Invalid editKind: ${editKindRaw}` }, 400);
    }

    const outputKind = OutputKindSchema.parse(outputKindRaw);

    // Validate editParams against the kind-specific schema. Bad JSON / wrong
    // shape returns 400 — workflow won't be reached.
    let editParams: unknown;
    try {
      editParams = JSON.parse(editParamsRaw);
    } catch {
      return c.json({ error: "editParams is not valid JSON" }, 400);
    }
    EditParamsByKind[editKind].parse(editParams);

    // Auth gates: project ownership + source asset belongs to same user.
    // Cross-user derivation is explicitly disallowed.
    await assertProjectOwner(c.env, projectId, userId);
    const source = await getAssetById(c.env.DB, sourceAssetId);
    if (!source) return c.json({ error: "Source asset not found" }, 404);
    if (source.userId !== userId) return c.json({ error: "Source asset not owned by user" }, 403);

    // R2 PUT — predictable key prefix lets GC distinguish edit outputs from
    // raw uploads / generation results.
    const newAssetId = crypto.randomUUID();
    const ext = (() => {
      if (outputKind === "image") return "png";
      if (outputKind === "video") return "mp4";
      return "mp3";
    })();
    const srcR2Key = `projects/${projectId}/edits/${newAssetId}.${ext}`;
    const contentType = file.type || (
      outputKind === "image" ? "image/png" :
      outputKind === "video" ? "video/mp4" : "audio/mpeg"
    );

    await c.env.R2_BUCKET.put(srcR2Key, file.stream(), {
      httpMetadata: { contentType },
    });

    const { metadata, coverR2Key } = await probeAsset(
      c.env,
      outputKind,
      srcR2Key,
      projectId,
    );

    const { id } = await createAsset(c.env.DB, {
      id: newAssetId,
      userId,
      kind: outputKind,
      srcR2Key,
      projectId,
      metadata,
      coverR2Key,
      sources: [{ assetId: sourceAssetId, role: "edit-source" }],
    });

    log.info("POST /edits created", {
      id,
      editKind,
      outputKind,
      sourceAssetId,
      hasCover: !!coverR2Key,
    });

    return c.json({ assetId: id, srcR2Key, coverR2Key: coverR2Key ?? null });
  } catch (e) {
    log.warn("POST /edits failed", { error: String(e) });
    return c.json({ error: String(e) }, 400);
  }
});

// ─── POST /api/v1/edits/video-crop ───────────────────────────
// Server-driven branch: the client doesn't ship a blob (would need ffmpeg.wasm
// to do the trim in-browser). Instead it hands us params; we delegate to the
// render-server for the ffmpeg work, then take ownership of R2 + D1 just like
// the multipart route above. Same auth gates apply.

const VideoCropRequestSchema = z.object({
  projectId: z.string().min(1),
  sourceAssetId: z.string().min(1),
  // params shape matches the `crop` arm of VideoClipParamsSchema; we narrow
  // here so the route doesn't have to deal with the screenshot arm.
  params: z.object({
    mode: z.literal("crop"),
    startSec: z.number().nonnegative(),
    endSec: z.number().positive(),
  }),
});

editsRoutes.post("/video-crop", async (c) => {
  try {
    const userId = getUserId(c);
    const body = VideoCropRequestSchema.parse(await c.req.json());

    if (body.params.endSec <= body.params.startSec) {
      return c.json({ error: "endSec must be > startSec" }, 400);
    }

    await assertProjectOwner(c.env, body.projectId, userId);
    const source = await getAssetById(c.env.DB, body.sourceAssetId);
    if (!source) return c.json({ error: "Source asset not found" }, 404);
    if (source.userId !== userId) return c.json({ error: "Source asset not owned by user" }, 403);
    if (source.kind !== "video") return c.json({ error: "Source asset is not a video" }, 400);

    // Run the ffmpeg trim. clipVideo signs the source URL itself.
    const clipped = await clipVideo(c.env, source.srcR2Key, {
      startSec: body.params.startSec,
      endSec: body.params.endSec,
    });

    const newAssetId = crypto.randomUUID();
    const srcR2Key = `projects/${body.projectId}/edits/${newAssetId}.mp4`;
    await c.env.R2_BUCKET.put(srcR2Key, clipped.bytes, {
      httpMetadata: { contentType: clipped.contentType },
    });

    const { metadata, coverR2Key } = await probeAsset(
      c.env,
      "video",
      srcR2Key,
      body.projectId,
    );

    const { id } = await createAsset(c.env.DB, {
      id: newAssetId,
      userId,
      kind: "video",
      srcR2Key,
      projectId: body.projectId,
      metadata,
      coverR2Key,
      sources: [{ assetId: body.sourceAssetId, role: "edit-source" }],
    });

    log.info("POST /edits/video-crop created", {
      id,
      sourceAssetId: body.sourceAssetId,
      durationMs: clipped.durationMs,
    });

    return c.json({ assetId: id, srcR2Key, coverR2Key: coverR2Key ?? null });
  } catch (e) {
    log.warn("POST /edits/video-crop failed", { error: String(e) });
    return c.json({ error: String(e) }, 400);
  }
});
