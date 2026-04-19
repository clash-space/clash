import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import type { Env } from "../config";
import { log } from "../logger";
import { Status } from "../domain/canvas";
import { generateDescription } from "../services/describe";
import { resolveImageProvider } from "../services/image-provider";
import { resolveVideoProvider } from "../services/video-provider";
import { uploadFromUrl, uploadBytes } from "../services/r2";
import { createAsset, getProjectOwner } from "../services/assets";
import { transcribeAudio } from "../services/asr";
import { analyzeVisual } from "../services/visual-understanding";
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
  type: "image_gen" | "video_gen" | "video_render" | "image_desc" | "video_desc" | "custom_action" | "understand";
  projectId: string;
  // image_gen fields
  prompt?: string;
  systemPrompt?: string;
  aspectRatio?: string;
  modelName?: string;
  modelParams?: Record<string, unknown>;
  /** R2 keys for reference images (resolved to fal URLs in workflow step) */
  referenceR2Keys?: string[];
  /** Structured prompt parts preserving text+image ordering (for parts-native APIs).
   *  Each part: { type: 'text', text } or { type: 'asset_ref', nodeId, r2Key } */
  promptParts?: Array<{ type: string; text?: string; nodeId?: string; r2Key?: string }>;
  // video_gen fields
  /** R2 key for source image (image-to-video, first frame for startEnd). */
  imageR2Key?: string;
  /** R2 key for the optional end/tail frame (models with startEnd inputMode). */
  tailImageR2Key?: string;
  /** R2 keys for reference videos (models with videos inputMode; e.g. Seedance ref-to-video). */
  referenceVideoR2Keys?: string[];
  /** R2 keys for reference audios (models with audios inputMode). */
  referenceAudioR2Keys?: string[];
  duration?: number;
  cfgScale?: number;
  videoModel?: string;
  // desc / understand fields
  r2Key?: string;
  mimeType?: string;
  /** Language hint for ASR (e.g. "zh", "en") */
  language?: string;
  // video_render fields
  timelineDsl?: Record<string, any>;
  // custom_action fields
  customActionId?: string;
  customActionParams?: Record<string, unknown>;
  workerUrl?: string;
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
    } else if (params.type === "custom_action") {
      await this.runCustomActionPipeline(params, step);
    } else if (params.type === "understand") {
      await this.runUnderstandPipeline(params, step);
    }

    log.info("Workflow completed", ctx);
  }

  private async runImagePipeline(params: GenerationParams, step: WorkflowStep): Promise<void> {
    const tag = { taskId: params.taskId, nodeId: params.nodeId };

    const storageKey = await step.do("generate-and-upload", {
      retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
      timeout: "5 minutes",
    }, async (ctx = { attempt: 1 }) => {
      log.info("Image generate started", { ...tag, model: params.modelName, attempt: ctx.attempt });

      // Resolve reference images: R2 keys → fal CDN URLs
      let referenceImageUrls: string[] | undefined;

      if (params.promptParts?.length) {
        // Parts-aware path: resolve asset_ref parts from R2 to fal CDN URLs
        // This preserves the ordering of text + image parts for future parts-native APIs
        referenceImageUrls = [];
        for (const part of params.promptParts) {
          if (part.type === 'asset_ref' && part.r2Key) {
            const falUrl = await uploadR2ToFal(this.env.R2_BUCKET, part.r2Key, this.env.FAL_API_KEY ?? "");
            referenceImageUrls.push(falUrl);
          }
        }
        if (referenceImageUrls.length === 0) referenceImageUrls = undefined;
        if (referenceImageUrls) {
          log.info("Prompt parts: resolved asset refs to fal URLs", { ...tag, count: referenceImageUrls.length });
        }
      }

      // Fallback: resolve from flat referenceR2Keys (legacy / non-parts path)
      if (!referenceImageUrls && params.referenceR2Keys?.length) {
        referenceImageUrls = [];
        for (const key of params.referenceR2Keys) {
          const falUrl = await uploadR2ToFal(this.env.R2_BUCKET, key, this.env.FAL_API_KEY ?? "");
          referenceImageUrls.push(falUrl);
        }
        log.info("Reference images uploaded to fal", { ...tag, count: referenceImageUrls.length });
      }

      const provider = resolveImageProvider(params.modelName);
      const result = await provider.generate(this.env, {
        prompt: params.prompt ?? "",
        systemPrompt: params.systemPrompt,
        referenceImageUrls,
        aspectRatio: params.aspectRatio,
        modelName: params.modelName,
        modelParams: params.modelParams,
      });
      log.info("Image generated", { ...tag, model: result.model });

      // Upload to R2: raw bytes (Google) or CDN URL (fal)
      const key = result.data
        ? await uploadBytes(this.env.R2_BUCKET, result.data, params.projectId, params.taskId, result.mediaType ?? "image/png")
        : await uploadFromUrl(this.env.R2_BUCKET, result.url!, params.projectId, params.taskId, "image/png");

      log.info("Image uploaded", { ...tag, storageKey: key });
      return key;
    });

    const assetId = await step.do("save-asset", {
      retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
      timeout: "30 seconds",
    }, async () => {
      const userId = (await getProjectOwner(this.env.DB, params.projectId)) ?? "";
      const { id } = await createAsset(this.env.DB, {
        id: params.taskId,                    // deterministic on workflow retry
        userId,
        kind: "image",
        srcR2Key: storageKey,
        projectId: params.projectId,
        sourceModel: params.modelName,
        sourcePrompt: params.prompt,
        sourceTaskId: params.taskId,
      });
      log.info("Asset saved to D1", { ...tag, assetId: id });
      return id;
    });

    // Notify ProjectRoom immediately (don't wait for polling)
    await this.notifyRoom(params.projectId, params.nodeId, {
      pendingTask: undefined,
      status: Status.Completed,
      assetId,
      src: storageKey,
      _log: undefined,
    });
  }

  private async runVideoPipeline(params: GenerationParams, step: WorkflowStep): Promise<void> {
    const tag = { taskId: params.taskId, nodeId: params.nodeId };

    // Resolve source image for image-to-video models (first frame / single image).
    let imageUrl: string | undefined;
    if (params.imageR2Key) {
      imageUrl = await step.do("resolve-source-image", {
        retries: { limit: 2, delay: "2 seconds" },
        timeout: "1 minute",
      }, async () => {
        const url = await uploadR2ToFal(this.env.R2_BUCKET, params.imageR2Key!, this.env.FAL_API_KEY ?? "");
        log.info("Source image resolved", { ...tag });
        return url;
      });
    }

    // Resolve optional tail/end frame for startEnd models.
    let tailImageUrl: string | undefined;
    if (params.tailImageR2Key) {
      tailImageUrl = await step.do("resolve-tail-image", {
        retries: { limit: 2, delay: "2 seconds" },
        timeout: "1 minute",
      }, async () => {
        return await uploadR2ToFal(this.env.R2_BUCKET, params.tailImageR2Key!, this.env.FAL_API_KEY ?? "");
      });
    }

    // Resolve multi-modal reference bundles (Seedance ref-to-video etc.).
    let refImageUrls: string[] | undefined;
    let refVideoUrls: string[] | undefined;
    let refAudioUrls: string[] | undefined;
    if ((params.referenceR2Keys?.length ?? 0) + (params.referenceVideoR2Keys?.length ?? 0) + (params.referenceAudioR2Keys?.length ?? 0) > 0) {
      const [imgs, vids, auds] = await step.do("resolve-refs", {
        retries: { limit: 2, delay: "2 seconds" },
        timeout: "3 minutes",
      }, async () => {
        const resolve = async (keys?: string[]) => {
          if (!keys?.length) return undefined;
          const out: string[] = [];
          for (const k of keys) out.push(await uploadR2ToFal(this.env.R2_BUCKET, k, this.env.FAL_API_KEY ?? ""));
          return out;
        };
        return [
          await resolve(params.referenceR2Keys),
          await resolve(params.referenceVideoR2Keys),
          await resolve(params.referenceAudioR2Keys),
        ] as const;
      });
      refImageUrls = imgs; refVideoUrls = vids; refAudioUrls = auds;
    }

    const provider = resolveVideoProvider(params.videoModel);
    const genResult = await step.do("generate", {
      retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
      timeout: "10 minutes",
    }, async (ctx = { attempt: 1 }) => {
      log.info("Video generate started", { ...tag, model: params.videoModel, attempt: ctx.attempt });

      const result = await provider.generate(this.env, {
        prompt: params.prompt ?? "",
        imageUrl,
        tailImageUrl,
        referenceImageUrls: refImageUrls,
        referenceVideoUrls: refVideoUrls,
        referenceAudioUrls: refAudioUrls,
        duration: params.duration,
        aspectRatio: params.aspectRatio,
        modelName: params.videoModel,
        modelParams: params.modelParams,
      });
      log.info("Video generated", { ...tag, model: result.model, hasCover: !!result.coverImageUrl });
      return result;
    });

    const { storageKey, coverKey } = await step.do("upload", {
      retries: { limit: 2, delay: "2 seconds" },
      timeout: "3 minutes",
    }, async (ctx = { attempt: 1 }) => {
      log.info("Video upload started", { ...tag, attempt: ctx.attempt });

      // Upload: raw bytes (Google) or CDN URL (fal)
      const sk = genResult.data
        ? await uploadBytes(this.env.R2_BUCKET, genResult.data, params.projectId, params.taskId, genResult.mediaType ?? "video/mp4")
        : await uploadFromUrl(this.env.R2_BUCKET, genResult.url!, params.projectId, params.taskId, "video/mp4");

      let coverKey: string | undefined;
      if (genResult.coverImageUrl) {
        try {
          coverKey = await uploadFromUrl(this.env.R2_BUCKET, genResult.coverImageUrl, params.projectId, `${params.taskId}-cover`, "image/jpeg");
        } catch (e) {
          log.error("Failed to upload cover image", { ...tag, error: String(e) });
        }
      }

      log.info("Video uploaded", { ...tag, storageKey: sk, hasCover: !!coverKey });
      return { storageKey: sk, coverKey };
    });

    const assetId = await step.do("save-asset", {
      retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
      timeout: "30 seconds",
    }, async () => {
      const userId = (await getProjectOwner(this.env.DB, params.projectId)) ?? "";
      const { id } = await createAsset(this.env.DB, {
        id: params.taskId,
        userId,
        kind: "video",
        srcR2Key: storageKey,
        coverR2Key: coverKey,
        projectId: params.projectId,
        sourceModel: params.videoModel,
        sourcePrompt: params.prompt,
        sourceTaskId: params.taskId,
      });
      log.info("Video asset saved to D1", { ...tag, assetId: id, hasCover: !!coverKey });
      return id;
    });

    // Notify ProjectRoom immediately
    await this.notifyRoom(params.projectId, params.nodeId, {
      pendingTask: undefined,
      status: Status.Completed,
      assetId,
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
    }, async (ctx = { attempt: 1 }) => {
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

    const assetId = await step.do("save-asset", {
      retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
      timeout: "30 seconds",
    }, async () => {
      const userId = (await getProjectOwner(this.env.DB, params.projectId)) ?? "";
      const { id } = await createAsset(this.env.DB, {
        id: params.taskId,
        userId,
        kind: "video",
        srcR2Key: storageKey,
        projectId: params.projectId,
        sourceTaskId: params.taskId,
      });
      log.info("Render asset saved to D1", { ...tag, assetId: id });
      return id;
    });

    await this.notifyRoom(params.projectId, params.nodeId, {
      pendingTask: undefined,
      status: Status.Completed,
      assetId,
      src: storageKey,
      _log: undefined,
    });
  }

  private async runDescPipeline(_params: GenerationParams, _step: WorkflowStep): Promise<void> {
    // TODO: description generation temporarily disabled
  }

  /**
   * Custom Action pipeline — calls an author-deployed CF Worker via HTTP.
   * Injects user variables (secrets) at runtime.
   */
  private async runCustomActionPipeline(params: GenerationParams, step: WorkflowStep): Promise<void> {
    const tag = { taskId: params.taskId, nodeId: params.nodeId, actionId: params.customActionId };

    // Step 1: Load user secrets for this action
    const secrets = await step.do("load-secrets", {
      timeout: "10 seconds",
    }, async () => {
      // TODO: resolve userId from projectId ownership
      // For now, load all secrets matching the action's declared secret keys
      // This will be implemented when auth context is passed through
      if (!this.env.ACTION_SECRET_KEY) return {};

      const { loadSecrets } = await import("../services/user-variables");
      // The action manifest's secrets[] are stored in Loro customActions map
      // For the workflow, we pass required keys through params (future enhancement)
      return {} as Record<string, string>;
    });

    // Step 2: Call the action Worker
    const result = await step.do("execute-action", {
      retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
      timeout: "5 minutes",
    }, async (ctx = { attempt: 1 }) => {
      log.info("Calling custom action worker", { ...tag, workerUrl: params.workerUrl, attempt: ctx.attempt });

      const resp = await fetch(params.workerUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: params.taskId,
          nodeId: params.nodeId,
          projectId: params.projectId,
          actionId: params.customActionId,
          prompt: params.prompt || "",
          params: params.customActionParams || {},
          secrets,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Action worker error ${resp.status}: ${errText}`);
      }

      const data = await resp.json() as Record<string, any>;
      log.info("Custom action response", { ...tag, type: data.type });
      return data;
    });

    // Step 3: If result has a URL, download and upload to R2
    let storageKey: string | undefined;
    if ((result.type === "image" || result.type === "video") && result.url) {
      storageKey = await step.do("upload-result", {
        retries: { limit: 2, delay: "2 seconds" },
        timeout: "3 minutes",
      }, async () => {
        const key = await uploadFromUrl(
          this.env.R2_BUCKET,
          result.url,
          params.projectId,
          params.taskId,
          result.mimeType || (result.type === "video" ? "video/mp4" : "image/png"),
        );
        log.info("Custom action result uploaded", { ...tag, storageKey: key });
        return key;
      });
    }

    // Step 4: Save asset to D1
    let assetId: string | undefined;
    if (storageKey) {
      assetId = await step.do("save-asset", {
        retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
        timeout: "30 seconds",
      }, async () => {
        const userId = (await getProjectOwner(this.env.DB, params.projectId)) ?? "";
        const kind = (result.type === "video" ? "video" : result.type === "audio" ? "audio" : "image") as "image" | "video" | "audio";
        const { id } = await createAsset(this.env.DB, {
          id: params.taskId,
          userId,
          kind,
          srcR2Key: storageKey!,
          projectId: params.projectId,
          sourceModel: params.customActionId,
          sourcePrompt: params.prompt,
          sourceTaskId: params.taskId,
        });
        return id;
      });
    }

    // Step 5: Notify ProjectRoom
    await this.notifyRoom(params.projectId, params.nodeId, {
      pendingTask: undefined,
      status: Status.Completed,
      ...(assetId ? { assetId } : {}),
      src: storageKey || "",
      content: result.content || undefined,
      description: result.description || undefined,
      _log: undefined,
    });
  }

  /**
   * Understanding pipeline — runs ASR (audio) and visual analysis (image/video) in sequence.
   * Results are written to node.data.understanding as key-level overwrites.
   */
  private async runUnderstandPipeline(params: GenerationParams, step: WorkflowStep): Promise<void> {
    const tag = { taskId: params.taskId, nodeId: params.nodeId };
    const r2Key = params.r2Key;
    const mimeType = params.mimeType || "";
    if (!r2Key) throw new Error("understand task requires r2Key");

    const isAudio = mimeType.startsWith("audio/");
    const isVideo = mimeType.startsWith("video/");
    const isImage = mimeType.startsWith("image/");

    const understanding: Record<string, unknown> = {};

    // Step 1: ASR transcription (for audio and video)
    if (isAudio || isVideo) {
      const transcription = await step.do("transcribe", {
        retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
        timeout: "5 minutes",
      }, async () => {
        log.info("ASR started", tag);
        const audioUrl = await uploadR2ToFal(this.env.R2_BUCKET, r2Key, this.env.FAL_API_KEY ?? "");
        const result = await transcribeAudio(this.env.FAL_API_KEY ?? "", audioUrl, {
          language: params.language,
        });
        log.info("ASR completed", { ...tag, textLength: result.text.length, segments: result.segments.length });
        return result;
      });
      understanding.transcription = transcription;
    }

    // Step 2: Visual analysis (for image and video)
    if (isImage || isVideo) {
      const visual = await step.do("visual-analyze", {
        retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
        timeout: "3 minutes",
      }, async () => {
        log.info("Visual analysis started", tag);
        const dataUri = await r2ToDataUri(this.env.R2_BUCKET, r2Key);
        const result = await analyzeVisual(this.env.AI, dataUri);
        log.info("Visual analysis completed", { ...tag, hasDescription: !!result.description, shots: result.shots?.length });
        return result;
      });
      understanding.visual = visual;
    }

    // Step 3: Notify room with understanding results
    await this.notifyRoom(params.projectId, params.nodeId, {
      pendingTask: undefined,
      understanding,
      _log: undefined,
    });

    log.info("Understand pipeline completed", tag);
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
