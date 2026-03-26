import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { ZodError } from "zod";

import type { Env } from "../config";
import { AssetStatus } from "../domain/canvas";
import { generateDescription } from "../services/describe";
import { createAsset, getAssetByTaskId, updateAssetStatus } from "../services/asset-store";
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
  console.error("Unhandled error:", err);
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

/** Delegate a generation task to the GenerationAgent DO. Marks asset failed on error. */
async function delegateToGenerationAgent(
  c: Context<{ Bindings: Env }>,
  taskId: string,
  genParams: GenerationParams
): Promise<Response | null> {
  try {
    const doId = c.env.GENERATION.idFromName(taskId);
    const stub = c.env.GENERATION.get(doId);
    await stub.fetch(new Request("https://do/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(genParams),
    }));
    return null; // success
  } catch (e) {
    console.error("Failed to delegate to GenerationAgent:", e);
    await updateAssetStatus(c.env.DB, taskId, {
      status: "failed",
      metadata: JSON.stringify({ error: `DO delegation failed: ${String(e)}` }),
    });
    return c.json({ error: "Failed to start generation task" }, 500);
  }
}

// ─── POST /api/generate/image ──────────────────────────────
//
// Pipeline: validate → D1 INSERT pending → delegate to GenerationAgent DO → return task_id
//

api.post("/api/generate/image", async (c) => {
  const body = GenerateImageRequestSchema.parse(await c.req.json());
  const taskId = crypto.randomUUID();

  // Resolve reference images to base64 upfront (lightweight, keeps DO simpler)
  const { base64Inputs, urlPromises } = resolveImagesToBase64(body.base64_images, body.reference_image_urls);
  const urlInputs = await urlPromises;
  const allImages = [...base64Inputs, ...urlInputs];

  // 1. Insert pending asset into D1
  await createAsset(c.env.DB, {
    id: body.asset_id,
    name: body.asset_name,
    projectId: body.project_id,
    storageKey: `pending/${taskId}`,
    url: "",
    type: "image",
    status: "pending",
    taskId,
    metadata: JSON.stringify({ prompt: body.prompt, model: body.model_name ?? DEFAULT_IMAGE_MODEL }),
  });

  // 2. Delegate to GenerationAgent DO
  const genParams: GenerationParams = {
    taskId,
    type: "image_gen",
    projectId: body.project_id,
    prompt: body.prompt,
    systemPrompt: body.system_prompt,
    aspectRatio: body.aspect_ratio,
    modelName: body.model_name ?? undefined,
    base64Images: allImages.length ? allImages : undefined,
  };

  const errorResponse = await delegateToGenerationAgent(c, taskId, genParams);
  if (errorResponse) return errorResponse;

  return c.json({
    base64: null,
    model: body.model_name ?? DEFAULT_IMAGE_MODEL,
    task_id: taskId,
  });
});

// ─── POST /api/generate/video ──────────────────────────────
//
// Pipeline: validate → resolve image → D1 INSERT pending → delegate to GenerationAgent DO → return task_id
//

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

  // 1. Insert pending asset into D1
  await createAsset(c.env.DB, {
    id: body.asset_id,
    name: body.asset_name,
    projectId: body.project_id,
    storageKey: `pending/${taskId}`,
    url: "",
    type: "video",
    status: "pending",
    taskId,
    metadata: JSON.stringify({ prompt: body.prompt, duration: body.duration, model: body.model }),
  });

  // 2. Delegate to GenerationAgent DO
  const genParams: GenerationParams = {
    taskId,
    type: "video_gen",
    projectId: body.project_id,
    prompt: body.prompt,
    imageBase64: imageToUse,
    duration: body.duration,
    cfgScale: body.cfg_scale,
    videoModel: body.model,
  };

  const errorResponse = await delegateToGenerationAgent(c, taskId, genParams);
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

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const description = await generateDescription(c.env.CF_AIG_TOKEN, body.url);
        // Update description directly in D1
        await updateAssetStatus(c.env.DB, body.task_id, {
          status: AssetStatus.Completed,
          description,
        });
      } catch (e) {
        console.error("Description generation failed:", e);
      }
    })()
  );

  return c.json({ task_id: body.task_id, status: AssetStatus.Processing });
});

// ─── GET /api/tasks/:taskId ────────────────────────────────
//
// Poll endpoint: frontend queries task status from D1.
//

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

  // Map to format expected by TaskPolling
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
//
// Unified task submission endpoint (replaces Python API).
// Dispatches by task_type to existing generation/description logic.
//

api.post("/api/tasks/submit", async (c) => {
  const body = TaskSubmitRequestSchema.parse(await c.req.json());
  const taskId = crypto.randomUUID();
  const { task_type, project_id, node_id, params } = body;

  if (task_type === "image_gen") {
    // Resolve reference images from R2 URLs to base64
    const referenceImages: string[] = params.reference_images ?? [];
    const resolvedImages: string[] = [];
    for (const ref of referenceImages) {
      if (ref.startsWith("http://") || ref.startsWith("https://")) {
        try {
          resolvedImages.push(await fetchUrlToBase64(ref));
        } catch (e) {
          console.error(`[tasks/submit] Failed to fetch reference image: ${ref}`, e);
        }
      } else if (ref.startsWith("projects/")) {
        // R2 key — fetch from R2 bucket
        try {
          const obj = await c.env.R2_BUCKET.get(ref);
          if (obj) {
            resolvedImages.push(arrayBufferToBase64(await obj.arrayBuffer()));
          }
        } catch (e) {
          console.error(`[tasks/submit] Failed to fetch R2 image: ${ref}`, e);
        }
      }
    }

    await createAsset(c.env.DB, {
      id: node_id,
      name: `image-${node_id.slice(0, 8)}`,
      projectId: project_id,
      storageKey: `pending/${taskId}`,
      url: "",
      type: "image",
      status: "pending",
      taskId,
      metadata: JSON.stringify({ prompt: params.prompt, model: params.model }),
    });

    const genParams: GenerationParams = {
      taskId,
      type: "image_gen",
      projectId: project_id,
      prompt: params.prompt ?? "",
      aspectRatio: params.aspect_ratio ?? "16:9",
      modelName: params.model,
      base64Images: resolvedImages.length ? resolvedImages : undefined,
    };

    const errorResponse = await delegateToGenerationAgent(c, taskId, genParams);
    if (errorResponse) return errorResponse;

    return c.json({ task_id: taskId, status: "pending" });
  }

  if (task_type === "video_gen") {
    // Resolve image from R2 key or URL
    let imageBase64: string | undefined;
    const imageRef = params.image_r2_key ?? params.reference_images?.[0];
    if (imageRef) {
      if (imageRef.startsWith("http://") || imageRef.startsWith("https://")) {
        imageBase64 = await fetchUrlToBase64(imageRef);
      } else if (imageRef.startsWith("projects/")) {
        const obj = await c.env.R2_BUCKET.get(imageRef);
        if (obj) {
          imageBase64 = arrayBufferToBase64(await obj.arrayBuffer());
        }
      }
    }

    if (!imageBase64) {
      return c.json({ error: "No image provided for video generation" }, 400);
    }

    await createAsset(c.env.DB, {
      id: node_id,
      name: `video-${node_id.slice(0, 8)}`,
      projectId: project_id,
      storageKey: `pending/${taskId}`,
      url: "",
      type: "video",
      status: "pending",
      taskId,
      metadata: JSON.stringify({ prompt: params.prompt, duration: params.duration, model: params.model }),
    });

    const genParams: GenerationParams = {
      taskId,
      type: "video_gen",
      projectId: project_id,
      prompt: params.prompt ?? "",
      imageBase64,
      duration: params.duration,
      cfgScale: params.cfg_scale,
      videoModel: params.model,
    };

    const errorResponse = await delegateToGenerationAgent(c, taskId, genParams);
    if (errorResponse) return errorResponse;

    return c.json({ task_id: taskId, status: "pending" });
  }

  if (task_type === "image_desc" || task_type === "video_desc") {
    // Description generation — resolve R2 key or URL, then generate async
    const r2Key = params.r2_key as string | undefined;
    if (!r2Key) {
      return c.json({ error: "Missing r2_key for description" }, 400);
    }

    // r2_key may be a full URL (from TaskPolling result_url) or an R2 storage key
    const assetUrl = r2Key.startsWith("http://") || r2Key.startsWith("https://")
      ? r2Key
      : `${c.env.R2_PUBLIC_URL}/${r2Key}`;

    // Create a placeholder asset record for tracking
    await createAsset(c.env.DB, {
      id: `desc-${node_id}`,
      name: `desc-${node_id.slice(0, 8)}`,
      projectId: project_id,
      storageKey: r2Key,
      url: assetUrl,
      type: task_type === "image_desc" ? "image" : "video",
      status: "processing",
      taskId,
    });

    // Generate description asynchronously
    c.executionCtx.waitUntil(
      (async () => {
        try {
          const description = await generateDescription(c.env.CF_AIG_TOKEN, assetUrl);
          await updateAssetStatus(c.env.DB, taskId, {
            status: AssetStatus.Completed,
            description,
          });
        } catch (e) {
          console.error("[tasks/submit] Description generation failed:", e);
          await updateAssetStatus(c.env.DB, taskId, {
            status: AssetStatus.Failed,
            metadata: JSON.stringify({ error: String(e) }),
          });
        }
      })()
    );

    return c.json({ task_id: taskId, status: "pending" });
  }

  if (task_type === "video_thumbnail") {
    // No-op: cover image is now captured during video generation from Kling API
    return c.json({ task_id: null, status: "completed" });
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
