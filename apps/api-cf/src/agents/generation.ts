import { Agent } from "agents";

import type { Env } from "../config";
import { AssetStatus } from "../domain/canvas";
import { generateDescription } from "../services/describe";
import { generateImage } from "../services/image-gen";
import { generateFalVideo } from "../services/fal-video";
import { uploadBase64Image, uploadVideoFromUrl } from "../services/r2";
import { getAssetByTaskId, updateAssetStatus } from "../services/asset-store";

export interface GenerationParams {
  taskId: string;
  type: "image_gen" | "video_gen";
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
}

/**
 * GenerationAgent — one DO instance per generation task.
 *
 * Handles: generate asset → upload R2 → update D1.
 * Uses `schedule()` for crash-recovery: if the DO restarts,
 * pending schedules in `cf_agents_schedules` re-trigger automatically.
 */
export class GenerationAgent extends Agent<Env> {
  onStart(): void {
    (this.ctx.storage.sql as any).exec(
      `CREATE TABLE IF NOT EXISTS task_state (id TEXT PRIMARY KEY, type TEXT, params TEXT, status TEXT)`
    );
  }

  async onRequest(request: Request): Promise<Response> {
    const params: GenerationParams = await request.json();

    // Persist task params in DO-local SQLite for crash recovery
    this.sql`INSERT OR REPLACE INTO task_state (id, type, params, status)
             VALUES (${params.taskId}, ${params.type}, ${JSON.stringify(params)}, 'running')`;

    console.log(`[GenerationAgent] Received task: ${params.taskId} type=${params.type}`);

    // Schedule for immediate execution + crash-recovery.
    // Do NOT also call run() directly — that causes double execution.
    await this.schedule(0, "run", params);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  async run(params: GenerationParams): Promise<void> {
    console.log(`[GenerationAgent] run() started: ${params.taskId} type=${params.type}`);
    try {
      const existing = await getAssetByTaskId(this.env.DB, params.taskId);
      if (existing && (existing.status === "completed" || existing.status === "failed")) {
        console.log(`[GenerationAgent] Task ${params.taskId} already ${existing.status}, skipping`);
        this.sql`UPDATE task_state SET status = ${existing.status} WHERE id = ${params.taskId}`;
        return;
      }

      if (params.type === "image_gen") {
        console.log(`[GenerationAgent] Starting image gen: prompt="${(params.prompt ?? "").slice(0, 50)}..."`);
        await this.runImageGen(params);
      } else if (params.type === "video_gen") {
        console.log(`[GenerationAgent] Starting video gen: prompt="${(params.prompt ?? "").slice(0, 50)}..."`);
        await this.runVideoGen(params);
      }
      console.log(`[GenerationAgent] Task ${params.taskId} completed successfully`);
      this.sql`UPDATE task_state SET status = 'completed' WHERE id = ${params.taskId}`;
    } catch (e) {
      console.error(`[GenerationAgent] Task ${params.taskId} failed:`, e);
      await updateAssetStatus(this.env.DB, params.taskId, {
        status: AssetStatus.Failed,
        metadata: JSON.stringify({ error: String(e) }),
      });
      this.sql`UPDATE task_state SET status = 'failed' WHERE id = ${params.taskId}`;
    }
  }

  private async runImageGen(params: GenerationParams): Promise<void> {
    // 1. Generate image via fal
    const base64Image = await generateImage(this.env.FAL_API_KEY ?? "", {
      text: params.prompt ?? "",
      systemPrompt: params.systemPrompt,
      base64Images: params.base64Images?.length ? params.base64Images : undefined,
      aspectRatio: params.aspectRatio,
      modelName: params.modelName,
      modelParams: params.modelParams,
    });

    // 2. Upload to R2
    const [storageKey, r2Url] = await uploadBase64Image(
      this.env.R2_BUCKET,
      this.env.R2_PUBLIC_URL,
      base64Image,
      params.projectId,
      params.taskId
    );

    // 3. Generate description using base64 directly (no public URL needed)
    const description = await this.tryGenerateDescription(`data:image/png;base64,${base64Image}`);
    await updateAssetStatus(this.env.DB, params.taskId, {
      status: AssetStatus.Completed,
      url: r2Url,
      storageKey,
      description: description ?? null,
    });
  }

  private async runVideoGen(params: GenerationParams): Promise<void> {
    // 1. Generate video via fal
    const falResult = await generateFalVideo(this.env.FAL_API_KEY ?? "", {
      prompt: params.prompt ?? "",
      imageBase64: params.imageBase64,
      duration: params.duration,
      aspectRatio: params.aspectRatio,
      videoModel: params.videoModel,
    });

    // 2. Upload video to R2
    const [storageKey, r2Url] = await uploadVideoFromUrl(
      this.env.R2_BUCKET,
      this.env.R2_PUBLIC_URL,
      falResult.url,
      params.projectId,
      params.taskId
    );

    // 3. Upload cover image to R2 if available
    let coverKey: string | undefined;
    let coverBase64: string | undefined;
    if (falResult.coverImageUrl) {
      try {
        const coverResp = await fetch(falResult.coverImageUrl);
        if (coverResp.ok) {
          const coverBuf = await coverResp.arrayBuffer();
          const coverBytes = new Uint8Array(coverBuf);
          // Keep base64 for description generation before uploading
          let binary = "";
          for (let i = 0; i < coverBytes.length; i++) binary += String.fromCharCode(coverBytes[i]);
          coverBase64 = btoa(binary);
          coverKey = `projects/${params.projectId}/assets/${params.taskId}-cover.jpg`;
          await this.env.R2_BUCKET.put(coverKey, coverBytes, {
            httpMetadata: { contentType: "image/jpeg" },
          });
        }
      } catch (e) {
        console.error("[GenerationAgent] Failed to upload cover image:", e);
      }
    }

    // 4. Generate description using cover image base64 if available (best-effort)
    const descBase64 = coverBase64 ? `data:image/jpeg;base64,${coverBase64}` : undefined;
    const description = descBase64 ? await this.tryGenerateDescription(descBase64) : undefined;
    const metadata: Record<string, unknown> = {};
    if (coverKey) metadata.cover_url = coverKey;

    await updateAssetStatus(this.env.DB, params.taskId, {
      status: AssetStatus.Completed,
      url: r2Url,
      storageKey,
      description: description ?? null,
      metadata: Object.keys(metadata).length ? JSON.stringify(metadata) : null,
    });
  }

  private async tryGenerateDescription(mediaUrl: string): Promise<string | undefined> {
    try {
      return await generateDescription(this.env.CF_AIG_TOKEN, mediaUrl);
    } catch (e) {
      console.error("[GenerationAgent] Failed to generate description:", e);
      return undefined;
    }
  }
}
