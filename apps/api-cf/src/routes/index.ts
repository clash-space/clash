import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { ZodError } from "zod";

import type { Env } from "../config";
import { log } from "../logger";
import { Status } from "../domain/canvas";
import { getAssetByTaskId, updateAssetStatus } from "../services/asset-store";
import { uploadBase64Image } from "../services/r2";
import type { GenerationParams } from "../agents/generation";
import {
  DEFAULT_IMAGE_MODEL,
  GenerateDescriptionRequestSchema,
  GenerateImageRequestSchema,
  GenerateSemanticIDRequestSchema,
  GenerateVideoRequestSchema,
  TaskSubmitRequestSchema,
} from "../domain/requests";

export const api = new Hono<{ Bindings: Env }>();

api.use("/*", cors());

api.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json({ error: "Validation failed", details: err.issues }, 400);
  }
  log.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// ─── Helpers ───────────────────────────────────────────────

function stripDataUrl(base64Str: string): string {
  const idx = base64Str.indexOf("base64,");
  return idx >= 0 ? base64Str.slice(idx + 7) : base64Str;
}

/** Convert an ArrayBuffer to a base64 string, chunked to avoid stack overflow. */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 8192;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(chunks.join(""));
}

const FETCH_TIMEOUT_MS = 30_000;

async function fetchUrlToBase64(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`Failed to fetch reference image: ${url}`);
    const buf = await resp.arrayBuffer();
    return arrayBufferToBase64(buf);
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === "AbortError") throw new Error(`Timed out fetching image: ${url}`);
    throw e;
  }
}

/** Resolve base64/URL image arrays to base64 strings. */
function resolveImagesToBase64(
  base64Images: string[] | undefined,
  referenceUrls: string[] | undefined
): { base64Inputs: string[]; urlPromises: Promise<string[]> } {
  const base64Inputs = (base64Images ?? []).filter(Boolean).map(stripDataUrl);
  const urlPromises = Promise.allSettled(
    (referenceUrls ?? []).filter(Boolean).map(fetchUrlToBase64)
  ).then((results) =>
    results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
      .map((r) => r.value)
  );
  return { base64Inputs, urlPromises };
}

/** Submit a generation task to the Workflow. Marks asset failed on error. */
async function submitToWorkflow(
  c: Context<{ Bindings: Env }>,
  taskId: string,
  genParams: GenerationParams
): Promise<Response | null> {
  try {
    await c.env.GENERATION_WORKFLOW.create({ id: taskId, params: genParams });
    return null; // success
  } catch (e) {
    log.error("Failed to create workflow instance:", e);
    await updateAssetStatus(c.env.DB, taskId, {
      status: Status.Failed,
      metadata: JSON.stringify({ error: `Workflow creation failed: ${String(e)}` }),
    });
    return c.json({ error: "Failed to start generation task" }, 500);
  }
}

// ─── POST /api/generate/image ──────────────────────────────

api.post("/api/generate/image", async (c) => {
  const body = GenerateImageRequestSchema.parse(await c.req.json());
  const taskId = crypto.randomUUID();

  // Resolve reference images to base64 upfront
  const { base64Inputs, urlPromises } = resolveImagesToBase64(body.base64_images, body.reference_image_urls);
  const urlInputs = await urlPromises;
  const allImages = [...base64Inputs, ...urlInputs];

  // Upload resolved base64 images to R2 to get R2 keys
  const referenceR2Keys: string[] = [];
  for (const b64 of allImages) {
    const key = await uploadBase64Image(c.env.R2_BUCKET, b64, body.project_id);
    referenceR2Keys.push(key);
  }

  // Submit to Workflow (D1 asset created inside workflow on completion)
  const genParams: GenerationParams = {
    taskId,
    nodeId: body.asset_id,
    type: "image_gen",
    projectId: body.project_id,
    prompt: body.prompt,
    systemPrompt: body.system_prompt,
    aspectRatio: body.aspect_ratio,
    modelName: body.model_name ?? undefined,
    referenceR2Keys: referenceR2Keys.length ? referenceR2Keys : undefined,
  };

  const errorResponse = await submitToWorkflow(c, taskId, genParams);
  if (errorResponse) return errorResponse;

  return c.json({
    base64: null,
    model: body.model_name ?? DEFAULT_IMAGE_MODEL,
    task_id: taskId,
  });
});

// ─── POST /api/generate/video ──────────────────────────────

api.post("/api/generate/video", async (c) => {
  const body = GenerateVideoRequestSchema.parse(await c.req.json());
  const taskId = crypto.randomUUID();

  const hasImage =
    body.image_url ||
    (body.base64_images ?? []).some(Boolean) ||
    (body.reference_image_urls ?? []).some(Boolean);
  if (!hasImage) {
    return c.json({ error: "No image provided" }, 400);
  }

  // Resolve primary image to base64
  let primaryBase64: string | undefined;
  if (body.image_url) {
    if (body.image_url.startsWith("http://") || body.image_url.startsWith("https://")) {
      primaryBase64 = await fetchUrlToBase64(body.image_url);
    } else if (body.image_url.includes("base64,")) {
      primaryBase64 = stripDataUrl(body.image_url);
    }
  }

  const { base64Inputs, urlPromises } = resolveImagesToBase64(body.base64_images, body.reference_image_urls);
  const urlInputs = await urlPromises;

  const imageToUse = primaryBase64 ?? base64Inputs[0] ?? urlInputs[0];
  if (!imageToUse) {
    return c.json({ error: "Failed to resolve image to base64" }, 400);
  }

  // Upload base64 image to R2 to get an R2 key
  const imageR2Key = await uploadBase64Image(c.env.R2_BUCKET, imageToUse, body.project_id);

  // Submit to Workflow (D1 asset created inside workflow on completion)
  const genParams: GenerationParams = {
    taskId,
    nodeId: body.asset_id,
    type: "video_gen",
    projectId: body.project_id,
    prompt: body.prompt,
    imageR2Key,
    duration: body.duration,
    cfgScale: body.cfg_scale,
    videoModel: body.model,
  };

  const errorResponse = await submitToWorkflow(c, taskId, genParams);
  if (errorResponse) return errorResponse;

  return c.json({
    url: null,
    duration: body.duration,
    model: body.model,
    task_id: taskId,
  });
});

// ─── POST /api/describe ────────────────────────────────────

api.post("/api/describe", async (c) => {
  const body = GenerateDescriptionRequestSchema.parse(await c.req.json());
  const taskId = body.task_id;

  // Submit description via Workflow for durability
  const genParams: GenerationParams = {
    taskId,
    nodeId: taskId,
    type: "image_desc",
    projectId: "",
    r2Key: body.url,
  };

  try {
    await c.env.GENERATION_WORKFLOW.create({ id: `desc-${taskId}`, params: genParams });
  } catch (e) {
    log.error("Failed to create description workflow:", e);
    return c.json({ error: "Failed to start description task" }, 500);
  }

  return c.json({ task_id: taskId, status: Status.Generating });
});

// ─── GET /api/tasks/:taskId ────────────────────────────────

api.get("/api/tasks/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const asset = await getAssetByTaskId(c.env.DB, taskId);

  if (!asset) {
    return c.json({ error: "Task not found" }, 404);
  }

  // Parse metadata for cover_url and error
  let metadataObj: Record<string, unknown> = {};
  if (asset.metadata) {
    try { metadataObj = JSON.parse(asset.metadata); } catch {}
  }

  return c.json({
    task_id: taskId,
    status: asset.status,
    result_url: asset.url || undefined,
    result_data: {
      description: asset.description || undefined,
      cover_url: (metadataObj.cover_url as string) || undefined,
    },
    error: (metadataObj.error as string) || undefined,
  });
});

// ─── POST /api/tasks/submit ────────────────────────────────

api.post("/api/tasks/submit", async (c) => {
  const body = TaskSubmitRequestSchema.parse(await c.req.json());
  const taskId = crypto.randomUUID();
  const { task_type, project_id, node_id, params } = body;

  if (task_type === "image_gen") {
    const referenceImages: string[] = params.reference_images ?? [];
    const resolvedR2Keys: string[] = [];
    for (const ref of referenceImages) {
      if (ref.startsWith("http://") || ref.startsWith("https://")) {
        try {
          const b64 = await fetchUrlToBase64(ref);
          const key = await uploadBase64Image(c.env.R2_BUCKET, b64, project_id);
          resolvedR2Keys.push(key);
        } catch (e) {
          log.error(`Failed to fetch reference image: ${ref}`, e);
        }
      } else if (ref.startsWith("projects/")) {
        resolvedR2Keys.push(ref);
      }
    }

    const genParams: GenerationParams = {
      taskId,
      nodeId: node_id,
      type: "image_gen",
      projectId: project_id,
      prompt: params.prompt ?? "",
      aspectRatio: params.aspect_ratio ?? "16:9",
      modelName: params.model,
      referenceR2Keys: resolvedR2Keys.length ? resolvedR2Keys : undefined,
    };

    const errorResponse = await submitToWorkflow(c, taskId, genParams);
    if (errorResponse) return errorResponse;

    return c.json({ task_id: taskId, status: Status.Pending });
  }

  if (task_type === "video_gen") {
    let imageR2Key: string | undefined;
    const imageRef = params.image_r2_key ?? params.reference_images?.[0];
    if (imageRef) {
      if (imageRef.startsWith("http://") || imageRef.startsWith("https://")) {
        const b64 = await fetchUrlToBase64(imageRef);
        imageR2Key = await uploadBase64Image(c.env.R2_BUCKET, b64, project_id);
      } else if (imageRef.startsWith("projects/")) {
        imageR2Key = imageRef;
      }
    }

    if (!imageR2Key) {
      return c.json({ error: "No image provided for video generation" }, 400);
    }

    const genParams: GenerationParams = {
      taskId,
      nodeId: node_id,
      type: "video_gen",
      projectId: project_id,
      prompt: params.prompt ?? "",
      imageR2Key,
      duration: params.duration,
      cfgScale: params.cfg_scale,
      videoModel: params.model,
    };

    const errorResponse = await submitToWorkflow(c, taskId, genParams);
    if (errorResponse) return errorResponse;

    return c.json({ task_id: taskId, status: Status.Pending });
  }

  if (task_type === "image_desc" || task_type === "video_desc") {
    const r2Key = params.r2_key as string | undefined;
    if (!r2Key) {
      return c.json({ error: "Missing r2_key for description" }, 400);
    }

    const cleanKey = r2Key.startsWith("http://") || r2Key.startsWith("https://")
      ? new URL(r2Key).pathname.replace(/^\//, "")
      : r2Key;

    const genParams: GenerationParams = {
      taskId,
      nodeId: node_id,
      type: task_type as GenerationParams["type"],
      projectId: project_id,
      r2Key: cleanKey,
      mimeType: params.mime_type as string || "image/png",
    };

    const errorResponse = await submitToWorkflow(c, taskId, genParams);
    if (errorResponse) return errorResponse;

    return c.json({ task_id: taskId, status: Status.Pending });
  }

  if (task_type === "video_thumbnail") {
    return c.json({ task_id: null, status: Status.Completed });
  }

  if (task_type === "audio_gen") {
    return c.json({ error: "Audio generation is not yet supported" }, 501);
  }

  if (task_type === "video_render") {
    return c.json({ error: "Video rendering is handled client-side via Remotion" }, 501);
  }

  return c.json({ error: `Unknown task_type: ${task_type}` }, 400);
});

// ─── POST /api/generate-ids ───────────────────────────────

api.post("/api/generate-ids", async (c) => {
  const body = GenerateSemanticIDRequestSchema.parse(await c.req.json());

  const ids: string[] = [];
  for (let i = 0; i < body.count; i++) {
    ids.push(crypto.randomUUID().slice(0, 8));
  }

  return c.json({ ids, project_id: body.project_id });
});
