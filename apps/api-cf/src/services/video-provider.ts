/**
 * Video generation provider interface + registry.
 *
 * Workflow calls `resolveVideoProvider(modelName).generate(params)`
 * without knowing which provider handles the model.
 */
import type { Env } from "../config";
import { generateFalVideo } from "./fal-video";
import { generateGoogleVideo, GOOGLE_VIDEO_MODELS, type VertexCredentials } from "./google-gen";

// ─── Interface ───────────────────────────────────────────

export interface VideoGenInput {
  prompt: string;
  imageUrl?: string;
  aspectRatio?: string;
  duration?: number;
  modelName?: string;
  modelParams?: Record<string, unknown>;
}

export interface VideoGenOutput {
  /** Either a CDN URL (fal) or raw bytes (Google) */
  url?: string;
  data?: Uint8Array;
  mediaType?: string;
  coverImageUrl?: string;
  duration: number;
  model: string;
}

export interface VideoProvider {
  generate(env: Env, params: VideoGenInput): Promise<VideoGenOutput>;
}

// ─── fal.ai Provider ────────────────────────────────────

const falVideoProvider: VideoProvider = {
  async generate(env, params) {
    const result = await generateFalVideo(env.FAL_API_KEY ?? "", {
      prompt: params.prompt,
      imageUrl: params.imageUrl,
      duration: params.duration,
      aspectRatio: params.aspectRatio,
      videoModel: params.modelName,
    });
    return {
      url: result.url,
      coverImageUrl: result.coverImageUrl,
      duration: result.duration,
      model: result.model,
    };
  },
};

// ─── Google Vertex Provider ─────────────────────────────

const googleVideoProvider: VideoProvider = {
  async generate(env, params) {
    const creds: VertexCredentials = {
      clientEmail: env.GOOGLE_CLIENT_EMAIL ?? "",
      privateKey: env.GOOGLE_PRIVATE_KEY ?? "",
      project: env.GOOGLE_CLOUD_PROJECT ?? "",
      location: env.GOOGLE_CLOUD_LOCATION ?? "global",
    };
    const result = await generateGoogleVideo(creds, {
      prompt: params.prompt,
      aspectRatio: params.aspectRatio,
      modelName: params.modelName,
      modelParams: params.modelParams,
    });
    return {
      data: result.data,
      mediaType: result.mediaType,
      duration: params.duration ?? 8,
      model: result.model,
    };
  },
};

// ─── Registry ───────────────────────────────────────────

export function resolveVideoProvider(modelName: string | undefined): VideoProvider {
  if (modelName && GOOGLE_VIDEO_MODELS.has(modelName)) {
    return googleVideoProvider;
  }
  return falVideoProvider;
}
