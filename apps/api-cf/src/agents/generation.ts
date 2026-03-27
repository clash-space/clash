import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import type { Env } from "../config";
import { log } from "../logger";
import { Status } from "../domain/canvas";
import { generateDescription } from "../services/describe";
import { generateImage } from "../services/image-gen";
import { generateFalVideo } from "../services/fal-video";
import { uploadFromUrl } from "../services/r2";
import { createAsset } from "../services/asset-store";
import { fal } from "@fal-ai/client";

/** Convert ArrayBuffer to base64 using chunked approach (avoids V8 crash). */
function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 8192;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(chunks.join(""));
}

/** Read R2 object and build data URI for generateDescription. */
async function r2ToDataUri(bucket: R2Bucket, key: string): Promise<string> {
  const obj = await bucket.get(key);
  if (!obj) throw new Error(`R2 object not found: ${key}`);
  const ct = obj.httpMetadata?.contentType || "image/png";
  const b64 = bufferToBase64(await obj.arrayBuffer());
  return `data:${ct};base64,${b64}`;
}

export interface GenerationParams {
  taskId: string;
  nodeId: string;
  type: "image_gen" | "video_gen" | "video_render" | "image_desc" | "video_desc";
  projectId: string;
  // image_gen fields
  prompt?: string;
  systemPrompt?: string;
  aspectRatio?: string;
  modelName?: string;
  modelParams?: Record<string, unknown>;
  /** R2 keys for reference images (resolved to fal URLs in workflow step) */
  referenceR2Keys?: string[];
  // video_gen fields
  /** R2 key for source image (image-to-video) */
  imageR2Key?: string;
  duration?: number;
  cfgScale?: number;
  videoModel?: string;
  // desc fields
  r2Key?: string;
  mimeType?: string;
  // video_render fields
  timelineDsl?: Record<string, any>;
}

/**
 * Upload an R2 object to fal's temporary CDN via fal.storage.upload().
 * Returns the fal CDN URL.
 */
async function uploadR2ToFal(bucket: R2Bucket, r2Key: string, falApiKey: string): Promise<string> {
  fal.config({ credentials: falApiKey });
  const obj = await bucket.get(r2Key);
  if (!obj) throw new Error(`R2 object not found: ${r2Key}`);
  const buf = await obj.arrayBuffer();
  const ct = obj.httpMetadata?.contentType || "image/png";
  const blob = new Blob([buf], { type: ct });
  return await fal.storage.upload(blob);
}

/**
 * GenerationWorkflow — durable multi-step pipeline for AIGC tasks.
 */
export class GenerationWorkflow extends WorkflowEntrypoint<Env, GenerationParams> {
  async run(event: WorkflowEvent<GenerationParams>, step: WorkflowStep): Promise<void> {
    const params = event.payload;
    const ctx = { taskId: params.taskId, nodeId: params.nodeId, type: params.type };

    log.info("Workflow started", ctx);

    if (params.type === "image_gen") {
      await this.runImagePipeline(params, step);
    } else if (params.type === "video_gen") {
      await this.runVideoPipeline(params, step);
    } else if (params.type === "video_render") {
      await this.runRenderPipeline(params, step);
    } else if (params.type === "image_desc" || params.type === "video_desc") {
      await this.runDescPipeline(params, step);
    }

    log.info("Workflow completed", ctx);
  }

  private async runImagePipeline(params: GenerationParams, step: WorkflowStep): Promise<void> {
    const tag = { taskId: params.taskId, nodeId: params.nodeId };

    const storageKey = await step.do("generate-and-upload", {
      retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
      timeout: "5 minutes",
    }, async (ctx) => {
      log.info("Image generate started", { ...tag, model: params.modelName, attempt: ctx.attempt });

      // Resolve reference images: R2 keys → fal CDN URLs
      let referenceImageUrls: string[] | undefined;
      if (params.referenceR2Keys?.length) {
        referenceImageUrls = [];
        for (const key of params.referenceR2Keys) {
          const falUrl = await uploadR2ToFal(this.env.R2_BUCKET, key, this.env.FAL_API_KEY ?? "");
          referenceImageUrls.push(falUrl);
        }
        log.info("Reference images uploaded to fal", { ...tag, count: referenceImageUrls.length });
      }

      const { url: imageUrl, requestId, model } = await generateImage(this.env.FAL_API_KEY ?? "", {
        text: params.prompt ?? "",
        systemPrompt: params.systemPrompt,
        referenceImageUrls,
        aspectRatio: params.aspectRatio,
        modelName: params.modelName,
        modelParams: params.modelParams,
        onEnqueue: (reqId) => log.info("fal accepted", { ...tag, falRequestId: reqId }),
        onQueueUpdate: (() => { let last = ""; return (s: any) => { if (s.status !== last) { last = s.status; log.info("fal status", { ...tag, falStatus: s.status }); } }; })(),
      });
      log.info("Image generated, uploading to R2", { ...tag, falRequestId: requestId, model });

      // Stream fal result URL directly to R2 (no base64)
      const key = await uploadFromUrl(
        this.env.R2_BUCKET,
        imageUrl,
        params.projectId,
        params.taskId,
        "image/png",
      );
      log.info("Image uploaded", { ...tag, storageKey: key });
      return key;
    });

    // TODO: description generation temporarily disabled
    const description = null;

    await step.do("save-asset", {
      retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
      timeout: "30 seconds",
    }, async () => {
      await createAsset(this.env.DB, {
        id: params.nodeId,
        name: `image-${params.nodeId.slice(0, 8)}`,
        projectId: params.projectId,
        storageKey,
        url: "",
        type: "image",
        status: Status.Completed,
        taskId: params.taskId,
        description: description ?? null,
        metadata: JSON.stringify({ prompt: params.prompt, model: params.modelName }),
      });
      log.info("Asset saved to D1", { ...tag, status: "completed" });
    });

    // Notify ProjectRoom immediately (don't wait for polling)
    await this.notifyRoom(params.projectId, params.nodeId, {
      pendingTask: undefined,
      status: Status.Completed,
      src: storageKey,
      _log: undefined,
    });
  }

  private async runVideoPipeline(params: GenerationParams, step: WorkflowStep): Promise<void> {
    const tag = { taskId: params.taskId, nodeId: params.nodeId };

    const falResult = await step.do("generate", {
      retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
      timeout: "10 minutes",
    }, async (ctx) => {
      log.info("Video generate started", { ...tag, model: params.videoModel, attempt: ctx.attempt });

      // Resolve source image: R2 key → fal CDN URL
      let imageUrl: string | undefined;
      if (params.imageR2Key) {
        imageUrl = await uploadR2ToFal(this.env.R2_BUCKET, params.imageR2Key, this.env.FAL_API_KEY ?? "");
        log.info("Source image uploaded to fal", { ...tag });
      }

      const result = await generateFalVideo(this.env.FAL_API_KEY ?? "", {
        prompt: params.prompt ?? "",
        imageUrl,
        duration: params.duration,
        aspectRatio: params.aspectRatio,
        videoModel: params.videoModel,
        onEnqueue: (reqId) => log.info("fal accepted", { ...tag, falRequestId: reqId }),
        onQueueUpdate: (() => { let last = ""; return (s: any) => { if (s.status !== last) { last = s.status; log.info("fal status", { ...tag, falStatus: s.status }); } }; })(),
      });
      log.info("Video generated", { ...tag, falRequestId: result.requestId, model: result.model, hasCover: !!result.coverImageUrl });
      return result;
    });

    const { storageKey, coverKey } = await step.do("upload", {
      retries: { limit: 2, delay: "2 seconds" },
      timeout: "3 minutes",
    }, async (ctx) => {
      log.info("Video upload started", { ...tag, attempt: ctx.attempt });

      // Stream video URL directly to R2
      const sk = await uploadFromUrl(
        this.env.R2_BUCKET,
        falResult.url,
        params.projectId,
        params.taskId,
        "video/mp4",
      );

      // Stream cover image to R2
      let coverKey: string | undefined;
      if (falResult.coverImageUrl) {
        try {
          coverKey = await uploadFromUrl(
            this.env.R2_BUCKET,
            falResult.coverImageUrl,
            params.projectId,
            `${params.taskId}-cover`,
            "image/jpeg",
          );
        } catch (e) {
          log.error("Failed to upload cover image", { ...tag, error: String(e) });
        }
      }

      log.info("Video uploaded", { ...tag, storageKey: sk, hasCover: !!coverKey });
      return { storageKey: sk, coverKey };
    });

    // TODO: description generation temporarily disabled
    const description = null;

    await step.do("save-asset", {
      retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
      timeout: "30 seconds",
    }, async () => {
      const metadata: Record<string, unknown> = { prompt: params.prompt, model: params.videoModel };
      if (coverKey) metadata.cover_url = coverKey;
      await createAsset(this.env.DB, {
        id: params.nodeId,
        name: `video-${params.nodeId.slice(0, 8)}`,
        projectId: params.projectId,
        storageKey,
        url: "",
        type: "video",
        status: Status.Completed,
        taskId: params.taskId,
        description: description ?? null,
        metadata: JSON.stringify(metadata),
      });
      log.info("Video asset saved to D1", { ...tag, status: "completed" });
    });

    // Notify ProjectRoom immediately
    await this.notifyRoom(params.projectId, params.nodeId, {
      pendingTask: undefined,
      status: Status.Completed,
      src: storageKey,
      ...(coverKey ? { coverUrl: coverKey } : {}),
      _log: undefined,
    });
  }

  private async runRenderPipeline(params: GenerationParams, step: WorkflowStep): Promise<void> {
    const tag = { taskId: params.taskId, nodeId: params.nodeId };

    const storageKey = await step.do("render-and-upload", {
      retries: { limit: 1, delay: "10 seconds" },
      timeout: "15 minutes",
    }, async (ctx) => {
      log.info("Render started", { ...tag, attempt: ctx.attempt });

      // Call render-server (Container in prod, direct URL in dev)
      let renderUrl: string;
      if (this.env.RENDER_SERVER_URL) {
        renderUrl = this.env.RENDER_SERVER_URL;
      } else {
        const container = (this.env.RENDER_CONTAINER as any).getByName(params.projectId);
        renderUrl = "https://container";
        // TODO: use container.fetch() directly when Container SDK stabilizes
      }

      const resp = await fetch(`${renderUrl}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timelineDsl: params.timelineDsl,
          projectId: params.projectId,
          taskId: params.taskId,
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Render server error ${resp.status}: ${err}`);
      }

      // Stream response body directly to R2
      const key = `projects/${params.projectId}/renders/${params.taskId}.mp4`;
      await this.env.R2_BUCKET.put(key, resp.body, {
        httpMetadata: { contentType: "video/mp4" },
      });

      log.info("Render uploaded to R2", { ...tag, storageKey: key });
      return key;
    });

    await step.do("save-asset", {
      retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
      timeout: "30 seconds",
    }, async () => {
      await createAsset(this.env.DB, {
        id: params.nodeId,
        name: `render-${params.nodeId.slice(0, 8)}`,
        projectId: params.projectId,
        storageKey,
        url: "",
        type: "video",
        status: Status.Completed,
        taskId: params.taskId,
        description: null,
      });
      log.info("Render asset saved to D1", { ...tag, status: "completed" });
    });

    await this.notifyRoom(params.projectId, params.nodeId, {
      pendingTask: undefined,
      status: Status.Completed,
      src: storageKey,
      _log: undefined,
    });
  }

  private async runDescPipeline(_params: GenerationParams, _step: WorkflowStep): Promise<void> {
    // TODO: description generation temporarily disabled
  }

  /** Push node update to ProjectRoom DO (same worker). */
  private async notifyRoom(projectId: string, nodeId: string, updates: Record<string, any>): Promise<void> {
    try {
      const roomId = this.env.ROOM.idFromName(projectId);
      const stub = this.env.ROOM.get(roomId);
      const resp = await stub.fetch(new Request(`https://do/sync/${projectId}/update-node`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId, updates }),
      }));
      await resp.text();
    } catch (e) {
      log.error("Failed to notify ProjectRoom", { projectId, nodeId, error: String(e) });
    }
  }
}
