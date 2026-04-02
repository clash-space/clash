/**
 * Image & video generation via Google Vertex AI (Vercel AI SDK).
 *
 * Uses @ai-sdk/google-vertex/edge with service account credentials
 * (clientEmail + privateKey from env vars).
 * Returns raw bytes (Uint8Array) — callers upload to R2.
 */
import { generateImage, experimental_generateVideo } from "ai";
import { createVertex } from "@ai-sdk/google-vertex/edge";

// ─── Shared ─────────────────────────────────────────────

export interface VertexCredentials {
  clientEmail: string;
  privateKey: string;
  project: string;
  location?: string;
}

function makeVertex(creds: VertexCredentials) {
  return createVertex({
    project: creds.project,
    location: creds.location ?? "global",
    googleCredentials: {
      clientEmail: creds.clientEmail,
      privateKey: creds.privateKey,
    },
  });
}

// ─── Image Generation (Imagen / Gemini Image) ───────────

export interface GoogleImageParams {
  prompt: string;
  aspectRatio?: string;
  modelName?: string;
  modelParams?: Record<string, unknown>;
}

export interface GoogleImageResult {
  data: Uint8Array;
  mediaType: string;
  model: string;
}

export const GOOGLE_IMAGE_MODELS = new Set([
  "imagen-4",
  "imagen-4-fast",
  "imagen-4-ultra",
  "gemini-flash-image",
  "gemini-flash-image-2",
  "gemini-pro-image",
]);

export function isGoogleImageModel(modelName: string | undefined): boolean {
  return !!modelName && GOOGLE_IMAGE_MODELS.has(modelName);
}

const GOOGLE_IMAGE_MODEL_MAP: Record<string, string> = {
  "imagen-4": "imagen-4.0-generate-001",
  "imagen-4-fast": "imagen-4.0-fast-generate-001",
  "imagen-4-ultra": "imagen-4.0-ultra-generate-001",
  "gemini-flash-image": "gemini-2.5-flash-image",
  "gemini-flash-image-2": "gemini-3.1-flash-image-preview",
  "gemini-pro-image": "gemini-3-pro-image-preview",
};

/**
 * Map model card params → Vertex image provider options.
 * Model card stores `aspect_ratio`, `resolution` etc;
 * Vertex SDK expects `sampleImageSize`, `negativePrompt`, etc.
 */
function buildImageProviderOptions(modelParams?: Record<string, unknown>) {
  const opts: Record<string, unknown> = {
    personGeneration: "allow_all",
  };
  if (!modelParams) return opts;

  // resolution: model card "1K"/"2K" → Vertex sampleImageSize
  if (modelParams.resolution) {
    opts.sampleImageSize = modelParams.resolution;
  }
  if (modelParams.negative_prompt || modelParams.negativePrompt) {
    opts.negativePrompt = modelParams.negative_prompt ?? modelParams.negativePrompt;
  }
  return opts;
}

export async function generateGoogleImage(
  creds: VertexCredentials,
  params: GoogleImageParams,
): Promise<GoogleImageResult> {
  const modelId = GOOGLE_IMAGE_MODEL_MAP[params.modelName ?? "imagen-4"] ?? "imagen-4.0-generate-001";
  const vertex = makeVertex(creds);
  const ar = (params.aspectRatio || "16:9") as `${number}:${number}`;

  const result = await generateImage({
    model: vertex.image(modelId),
    prompt: params.prompt,
    aspectRatio: ar,
    providerOptions: {
      vertex: buildImageProviderOptions(params.modelParams) as Record<string, any>,
    },
  });

  return {
    data: result.image.uint8Array,
    mediaType: result.image.mediaType,
    model: modelId,
  };
}

// ─── Video Generation (Veo) ─────────────────────────────

export interface GoogleVideoParams {
  prompt: string;
  aspectRatio?: string;
  modelName?: string;
  modelParams?: Record<string, unknown>;
}

export interface GoogleVideoResult {
  data: Uint8Array;
  mediaType: string;
  model: string;
}

export const GOOGLE_VIDEO_MODELS = new Set([
  "veo-3.1",
  "veo-3.1-lite",
  "veo-3.1-fast",
]);

export function isGoogleVideoModel(modelName: string | undefined): boolean {
  return !!modelName && GOOGLE_VIDEO_MODELS.has(modelName);
}

const GOOGLE_VIDEO_MODEL_MAP: Record<string, string> = {
  "veo-3.1": "veo-3.1-generate-preview",
  "veo-3.1-lite": "veo-3.1-lite-generate-preview",
  "veo-3.1-fast": "veo-3.1-fast-generate-preview",
};

/**
 * Map model card params → Vertex video provider options.
 * Model card stores `generate_audio`, `aspect_ratio`;
 * Vertex SDK expects `generateAudio`, top-level `aspectRatio`.
 */
function buildVideoProviderOptions(modelParams?: Record<string, unknown>) {
  const opts: Record<string, unknown> = {
    personGeneration: "allow_all",
  };
  if (!modelParams) return opts;

  // generate_audio → generateAudio
  if (modelParams.generate_audio !== undefined) {
    opts.generateAudio = modelParams.generate_audio;
  }
  if (modelParams.negative_prompt || modelParams.negativePrompt) {
    opts.negativePrompt = modelParams.negative_prompt ?? modelParams.negativePrompt;
  }
  return opts;
}

export async function generateGoogleVideo(
  creds: VertexCredentials,
  params: GoogleVideoParams,
): Promise<GoogleVideoResult> {
  const modelId = GOOGLE_VIDEO_MODEL_MAP[params.modelName ?? "veo-3.1"] ?? "veo-3.1-generate-preview";
  const vertex = makeVertex(creds);
  const ar = (params.aspectRatio || "16:9") as `${number}:${number}`;

  const result = await experimental_generateVideo({
    model: vertex.video(modelId),
    prompt: params.prompt,
    aspectRatio: ar,
    providerOptions: {
      vertex: buildVideoProviderOptions(params.modelParams) as Record<string, any>,
    },
  });

  return {
    data: result.video.uint8Array,
    mediaType: result.video.mediaType,
    model: modelId,
  };
}
