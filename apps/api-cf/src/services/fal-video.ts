/**
 * Video generation via fal.ai.
 *
 * Supported models:
 *   - fal-ai/sora-2/text-to-video              (text only)
 *   - fal-ai/sora-2/image-to-video/pro          (image + text)
 *   - fal-ai/kling-video/v2.1/standard/text-to-video
 *   - fal-ai/kling-video/v2.1/standard/image-to-video
 */
import { fal } from "@fal-ai/client";

interface FalVideoParams {
  prompt: string;
  /** Base64 image (with or without data: prefix) for image-to-video. */
  imageBase64?: string;
  /** Duration in seconds. Sora: 4/8/12/16/20. Kling: 5/10 (passed as string). */
  duration?: number | string;
  aspectRatio?: string;
  /** Model card ID, e.g. "kling-2.1-text-to-video". Defaults to sora-2. */
  videoModel?: string;
}

interface FalVideoResult {
  url: string;
  coverImageUrl?: string;
  duration: number;
}

function stripDataUrl(base64Str: string): string {
  if (base64Str.startsWith("data:")) {
    const idx = base64Str.indexOf(",");
    return idx >= 0 ? base64Str.slice(idx + 1) : base64Str;
  }
  return base64Str;
}

/**
 * Generate a video using fal.ai.
 * Routes to the appropriate model based on `videoModel` and whether an image is provided.
 */
export async function generateFalVideo(
  falApiKey: string,
  params: FalVideoParams,
): Promise<FalVideoResult> {
  fal.config({ credentials: falApiKey });

  const { videoModel, imageBase64 } = params;

  if (videoModel === 'kling-2.1-text-to-video' || videoModel === 'kling-2.1-image-to-video') {
    return generateKlingVideo(params);
  }

  return generateSoraVideo(params);
}

async function generateSoraVideo(params: FalVideoParams): Promise<FalVideoResult> {
  const hasImage = !!params.imageBase64;
  const modelId = hasImage
    ? "fal-ai/sora-2/image-to-video/pro"
    : "fal-ai/sora-2/text-to-video";

  const durationNum = typeof params.duration === 'string' ? parseInt(params.duration, 10) : (params.duration ?? 4);

  const input: Record<string, unknown> = {
    prompt: params.prompt,
    duration: durationNum,
    aspect_ratio: params.aspectRatio || "16:9",
    resolution: "720p",
    delete_video: false,
  };

  if (hasImage) {
    input.image_url = `data:image/jpeg;base64,${stripDataUrl(params.imageBase64!)}`;
  }

  const result = await fal.subscribe(modelId, { input } as any);
  const data = result.data as {
    video?: { url: string; duration?: number };
    thumbnail?: { url: string };
  };

  if (!data.video?.url) {
    throw new Error("No video in sora-2 response");
  }

  return {
    url: data.video.url,
    coverImageUrl: data.thumbnail?.url,
    duration: data.video.duration ?? durationNum,
  };
}

async function generateKlingVideo(params: FalVideoParams): Promise<FalVideoResult> {
  const hasImage = !!params.imageBase64;
  const modelId = hasImage
    ? "fal-ai/kling-video/v2.1/standard/image-to-video"
    : "fal-ai/kling-video/v2.1/standard/text-to-video";

  // Kling duration is a string "5" or "10"
  const durationStr = typeof params.duration === 'number'
    ? (params.duration <= 5 ? "5" : "10")
    : (params.duration ?? "5");

  const durationNum = parseInt(durationStr as string, 10);

  const input: Record<string, unknown> = {
    prompt: params.prompt,
    duration: durationStr,
    aspect_ratio: params.aspectRatio || "16:9",
  };

  if (hasImage) {
    input.image_url = `data:image/jpeg;base64,${stripDataUrl(params.imageBase64!)}`;
  }

  console.log(`[fal-video] Calling Kling: ${modelId}, duration=${durationStr}, aspect=${params.aspectRatio}`);
  const result = await fal.subscribe(modelId, { input } as any);
  const data = result.data as {
    video?: { url: string; content_type?: string };
  };

  if (!data.video?.url) {
    throw new Error("No video in kling response");
  }

  return {
    url: data.video.url,
    duration: durationNum,
  };
}
