/**
 * Video generation provider interface + registry.
 *
 * Each provider consumes raw R2 keys and resolves them internally into the
 * shape its API expects (public URL for fal, base64 for Google Vertex).
 * The pipeline doesn't know or care — it just hands over R2 keys.
 */
import { fal } from "@fal-ai/client";
import { Buffer } from "node:buffer";
import type { Env } from "../config";
import { generateFalVideo } from "./fal-video";
import { generateGoogleVideo, GOOGLE_VIDEO_MODELS, type VertexCredentials } from "./google-gen";

// ─── Interface ───────────────────────────────────────────

export interface VideoGenInput {
  prompt: string;
  /** startEnd: first frame anchor */
  startFrameR2Key?: string;
  /** startEnd: last frame anchor */
  endFrameR2Key?: string;
  /** Flat list of reference images (provider decides wire mapping). */
  referenceImageR2Keys?: string[];
  referenceVideoR2Keys?: string[];
  referenceAudioR2Keys?: string[];
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

// ─── Shared helpers ─────────────────────────────────────

async function readR2AsBase64Image(
  bucket: R2Bucket,
  key: string,
): Promise<{ bytesBase64Encoded: string; mimeType: string }> {
  const obj = await bucket.get(key);
  if (!obj) throw new Error(`R2 object not found: ${key}`);
  const mimeType = obj.httpMetadata?.contentType || "image/png";
  const buf = await obj.arrayBuffer();
  // Native C++ base64 from node:buffer (workerd nodejs_compat) — much faster
  // and cheaper than the JS `btoa(String.fromCharCode(...))` chunked trick.
  return { bytesBase64Encoded: Buffer.from(buf).toString("base64"), mimeType };
}

async function uploadR2ToFal(
  bucket: R2Bucket,
  r2Key: string,
  falApiKey: string,
): Promise<string> {
  fal.config({ credentials: falApiKey });
  const obj = await bucket.get(r2Key);
  if (!obj) throw new Error(`R2 object not found: ${r2Key}`);
  const buf = await obj.arrayBuffer();
  const ct = obj.httpMetadata?.contentType || "image/png";
  const blob = new Blob([buf], { type: ct });
  return await fal.storage.upload(blob);
}

// ─── fal.ai Provider ────────────────────────────────────

const falVideoProvider: VideoProvider = {
  async generate(env, params) {
    const falApiKey = env.FAL_API_KEY ?? "";
    const toFal = (k?: string) => (k ? uploadR2ToFal(env.R2_BUCKET, k, falApiKey) : Promise.resolve(undefined));
    const toFalAll = async (keys?: string[]) => {
      if (!keys?.length) return undefined;
      return Promise.all(keys.map((k) => uploadR2ToFal(env.R2_BUCKET, k, falApiKey)));
    };

    const [startFrameUrl, endFrameUrl, referenceImageUrls, referenceVideoUrls, referenceAudioUrls] = await Promise.all([
      toFal(params.startFrameR2Key),
      toFal(params.endFrameR2Key),
      toFalAll(params.referenceImageR2Keys),
      toFalAll(params.referenceVideoR2Keys),
      toFalAll(params.referenceAudioR2Keys),
    ]);

    const result = await generateFalVideo(falApiKey, {
      prompt: params.prompt,
      startFrameUrl,
      endFrameUrl,
      referenceImageUrls,
      referenceVideoUrls,
      referenceAudioUrls,
      duration: params.duration,
      aspectRatio: params.aspectRatio,
      videoModel: params.modelName,
      modelParams: params.modelParams,
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

    // Vertex wants base64 in-body — read R2 directly, no third party.
    const toBase64 = (k?: string) =>
      k ? readR2AsBase64Image(env.R2_BUCKET, k) : Promise.resolve(undefined);
    const toBase64All = async (keys?: string[]) => {
      if (!keys?.length) return undefined;
      return Promise.all(keys.map((k) => readR2AsBase64Image(env.R2_BUCKET, k)));
    };

    const [image, tailImage, referenceImages] = await Promise.all([
      toBase64(params.startFrameR2Key),
      toBase64(params.endFrameR2Key),
      toBase64All(params.referenceImageR2Keys),
    ]);

    const result = await generateGoogleVideo(creds, {
      prompt: params.prompt,
      aspectRatio: params.aspectRatio,
      modelName: params.modelName,
      modelParams: params.modelParams,
      image,
      tailImage,
      referenceImages,
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
