/**
 * Image generation provider interface + registry.
 *
 * Workflow calls `resolveImageProvider(modelName).generate(params)`
 * without knowing which provider handles the model.
 */
import type { Env } from "../config";
import { generateImage as generateFalImage } from "./fal-image";
import { generateGoogleImage, GOOGLE_IMAGE_MODELS, type GoogleServiceAccount } from "./google-gen";

// ─── Interface ───────────────────────────────────────────

export interface ImageGenInput {
  prompt: string;
  systemPrompt?: string;
  referenceImageUrls?: string[];
  aspectRatio?: string;
  modelName?: string;
  modelParams?: Record<string, unknown>;
  credentials?: Record<string, string>;
  serviceAccountKey?: GoogleServiceAccount;
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

const falImageAdapter: ImageProvider = {
  async generate(_env, params) {
    const falKey = params.credentials?.apiKey;
    if (!falKey) throw new Error("fal provider account is missing apiKey.");
    const { url, model } = await generateFalImage(falKey, {
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

const googleAgentPlatformImageAdapter: ImageProvider = {
  async generate(_env, params) {
    if (!params.serviceAccountKey) throw new Error("Google Cloud Agent Platform provider account is missing service account credentials.");
    const result = await generateGoogleImage(params.serviceAccountKey, {
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
    return googleAgentPlatformImageAdapter;
  }
  return falImageAdapter;
}
