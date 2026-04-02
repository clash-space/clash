/**
 * Image generation provider interface + registry.
 *
 * Workflow calls `resolveImageProvider(modelName).generate(params)`
 * without knowing which provider handles the model.
 */
import type { Env } from "../config";
import { generateImage as generateFalImage } from "./fal-image";
import { generateGoogleImage, GOOGLE_IMAGE_MODELS, type VertexCredentials } from "./google-gen";

// ─── Interface ───────────────────────────────────────────

export interface ImageGenInput {
  prompt: string;
  systemPrompt?: string;
  referenceImageUrls?: string[];
  aspectRatio?: string;
  modelName?: string;
  modelParams?: Record<string, unknown>;
}

export interface ImageGenOutput {
  /** Either a CDN URL (fal) or raw bytes (Google) */
  url?: string;
  data?: Uint8Array;
  mediaType?: string;
  model: string;
}

export interface ImageProvider {
  generate(env: Env, params: ImageGenInput): Promise<ImageGenOutput>;
}

// ─── fal.ai Provider ────────────────────────────────────

const falImageProvider: ImageProvider = {
  async generate(env, params) {
    const { url, model } = await generateFalImage(env.FAL_API_KEY ?? "", {
      text: params.prompt,
      systemPrompt: params.systemPrompt,
      referenceImageUrls: params.referenceImageUrls,
      aspectRatio: params.aspectRatio,
      modelName: params.modelName,
      modelParams: params.modelParams,
    });
    return { url, model };
  },
};

// ─── Google Vertex Provider ─────────────────────────────

const googleImageProvider: ImageProvider = {
  async generate(env, params) {
    const creds: VertexCredentials = {
      clientEmail: env.GOOGLE_CLIENT_EMAIL ?? "",
      privateKey: env.GOOGLE_PRIVATE_KEY ?? "",
      project: env.GOOGLE_CLOUD_PROJECT ?? "",
      location: env.GOOGLE_CLOUD_LOCATION ?? "global",
    };
    const result = await generateGoogleImage(creds, {
      prompt: params.prompt,
      aspectRatio: params.aspectRatio,
      modelName: params.modelName,
      modelParams: params.modelParams,
    });
    return { data: result.data, mediaType: result.mediaType, model: result.model };
  },
};

// ─── Registry ───────────────────────────────────────────

export function resolveImageProvider(modelName: string | undefined): ImageProvider {
  if (modelName && GOOGLE_IMAGE_MODELS.has(modelName)) {
    return googleImageProvider;
  }
  return falImageProvider;
}
