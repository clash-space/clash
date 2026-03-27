import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import type { Env } from "../config";
import { log } from "../logger";
import { Status } from "../domain/canvas";
import { generateDescription } from "../services/describe";
import { generateImage } from "../services/image-gen";
import { generateFalVideo } from "../services/fal-video";
import { uploadBase64Image, uploadVideoFromUrl } from "../services/r2";
import { createAsset } from "../services/asset-store";

export interface GenerationParams {
  taskId: string;
  nodeId: string;
  type: "image_gen" | "video_gen" | "image_desc" | "video_desc";
  projectId: string;
  // image_gen fields
  prompt?: string;
  systemPrompt?: string;
  aspectRatio?: string;
  modelName?: string;
  modelParams?: Record<string, unknown>;
  base64Images?: string[];
  referenceImageUrls?: string[];
  // video_gen fields
  imageBase64?: string;
  duration?: number;
  cfgScale?: number;
  videoModel?: string;
  // desc fields
  r2Key?: string;
  mimeType?: string;
}

/**
 * GenerationWorkflow — durable multi-step pipeline for AIGC tasks.
 *
 * Each step is automatically persisted and retried on failure.
 * Replaces the old GenerationAgent DO with proper crash recovery.
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
      const { base64: base64Image, requestId, model } = await generateImage(this.env.FAL_API_KEY ?? "", {
        text: params.prompt ?? "",
        systemPrompt: params.systemPrompt,
        base64Images: params.base64Images?.length ? params.base64Images : undefined,
        aspectRatio: params.aspectRatio,
        modelName: params.modelName,
        modelParams: params.modelParams,
        onEnqueue: (reqId) => log.info("fal enqueued", { ...tag, falRequestId: reqId }),
        onQueueUpdate: (s) => log.info("fal poll", { ...tag, falStatus: s.status, falPosition: s.position }),
      });
      log.info("Image generated, uploading to R2", { ...tag, falRequestId: requestId, model, sizeKB: Math.round(base64Image.length / 1024) });

      const key = await uploadBase64Image(
        this.env.R2_BUCKET,
        base64Image,
        params.projectId,
        params.taskId,
      );
      log.info("Image uploaded", { ...tag, storageKey: key });
      return key;
    });

    const description = await step.do("describe", {
      retries: { limit: 2, delay: "3 seconds", backoff: "exponential" },
      timeout: "2 minutes",
    }, async (ctx) => {
      try {
        log.info("Description generation started", { ...tag, attempt: ctx.attempt });
        const obj = await this.env.R2_BUCKET.get(storageKey);
        if (!obj) return null;
        const buf = await obj.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const desc = await generateDescription(
          this.env.CF_AIG_TOKEN,
          `data:image/png;base64,${btoa(binary)}`,
        );
        log.info("Description generated", { ...tag, descLength: desc?.length });
        return desc;
      } catch (e) {
        log.error("Description generation failed", { ...tag, error: String(e) });
        return null;
      }
    });

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
  }

  private async runVideoPipeline(params: GenerationParams, step: WorkflowStep): Promise<void> {
    const tag = { taskId: params.taskId, nodeId: params.nodeId };

    const falResult = await step.do("generate", {
      retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
      timeout: "10 minutes",
    }, async (ctx) => {
      log.info("Video generate started", { ...tag, model: params.videoModel, attempt: ctx.attempt });
      const result = await generateFalVideo(this.env.FAL_API_KEY ?? "", {
        prompt: params.prompt ?? "",
        imageBase64: params.imageBase64,
        duration: params.duration,
        aspectRatio: params.aspectRatio,
        videoModel: params.videoModel,
        onEnqueue: (reqId) => log.info("fal enqueued", { ...tag, falRequestId: reqId }),
        onQueueUpdate: (s) => log.info("fal poll", { ...tag, falStatus: s.status, falPosition: s.position }),
      });
      log.info("Video generated", { ...tag, falRequestId: result.requestId, model: result.model, hasCover: !!result.coverImageUrl });
      return result;
    });

    const { storageKey, coverKey } = await step.do("upload", {
      retries: { limit: 2, delay: "2 seconds" },
      timeout: "3 minutes",
    }, async (ctx) => {
      log.info("Video upload started", { ...tag, attempt: ctx.attempt });
      const sk = await uploadVideoFromUrl(
        this.env.R2_BUCKET,
        falResult.url,
        params.projectId,
        params.taskId,
      );

      let coverKey: string | undefined;
      if (falResult.coverImageUrl) {
        try {
          const coverResp = await fetch(falResult.coverImageUrl);
          if (coverResp.ok) {
            const coverBytes = new Uint8Array(await coverResp.arrayBuffer());
            coverKey = `projects/${params.projectId}/assets/${params.taskId}-cover.jpg`;
            await this.env.R2_BUCKET.put(coverKey, coverBytes, {
              httpMetadata: { contentType: "image/jpeg" },
            });
          }
        } catch (e) {
          log.error("Failed to upload cover image:", e);
        }
      }

      log.info("Video uploaded", { ...tag, storageKey: sk, hasCover: !!coverKey });
      return { storageKey: sk, coverKey };
    });

    const description = await step.do("describe", {
      retries: { limit: 2, delay: "3 seconds", backoff: "exponential" },
      timeout: "2 minutes",
    }, async (ctx) => {
      if (!coverKey) return null;
      try {
        log.info("Video description started", { ...tag, attempt: ctx.attempt });
        const obj = await this.env.R2_BUCKET.get(coverKey);
        if (!obj) return null;
        const buf = await obj.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const desc = await generateDescription(
          this.env.CF_AIG_TOKEN,
          `data:image/jpeg;base64,${btoa(binary)}`,
        );
        log.info("Video description generated", { ...tag, descLength: desc?.length });
        return desc;
      } catch (e) {
        log.error("Video description failed", { ...tag, error: String(e) });
        return null;
      }
    });

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
  }

  private async runDescPipeline(params: GenerationParams, step: WorkflowStep): Promise<void> {
    const tag = { taskId: params.taskId, nodeId: params.nodeId };

    const description = await step.do("describe", {
      retries: { limit: 2, delay: "3 seconds", backoff: "exponential" },
      timeout: "2 minutes",
    }, async (ctx) => {
      const r2Key = params.r2Key;
      if (!r2Key) throw new Error("Missing r2Key for description task");

      log.info("Desc pipeline started", { ...tag, r2Key, attempt: ctx.attempt });
      const obj = await this.env.R2_BUCKET.get(r2Key);
      if (!obj) throw new Error(`R2 object not found: ${r2Key}`);

      const buf = await obj.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const mimeType = params.mimeType || "image/png";
      const dataUrl = `data:${mimeType};base64,${btoa(binary)}`;

      const desc = await generateDescription(this.env.CF_AIG_TOKEN, dataUrl);
      log.info("Desc generated", { ...tag, descLength: desc?.length });
      return desc;
    });

    await step.do("save-asset", {
      retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
      timeout: "30 seconds",
    }, async () => {
      await createAsset(this.env.DB, {
        id: `desc-${params.nodeId}`,
        name: `desc-${params.nodeId.slice(0, 8)}`,
        projectId: params.projectId,
        storageKey: params.r2Key ?? "",
        url: "",
        type: params.type === "image_desc" ? "image" : "video",
        status: Status.Completed,
        taskId: params.taskId,
        description,
      });
      log.info("Desc asset saved to D1", { ...tag, status: "completed" });
    });
  }
}
