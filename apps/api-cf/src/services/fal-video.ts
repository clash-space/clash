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
  /** URL of source image (fal CDN URL, not base64) */
  imageUrl?: string;
  duration?: number | string;
  aspectRatio?: string;
  videoModel?: string;
  onEnqueue?: (requestId: string) => void;
  onQueueUpdate?: (status: { status: string; position?: number }) => void;
}

interface FalVideoResult {
  url: string;
  coverImageUrl?: string;
  duration: number;
  requestId: string;
  model: string;
}

/**
 * Generate a video using fal.ai.
 */
export async function generateFalVideo(
  falApiKey: string,
  params: FalVideoParams,
): Promise<FalVideoResult> {
  fal.config({ credentials: falApiKey });

  if (params.videoModel === 'kling-2.1-text-to-video' || params.videoModel === 'kling-2.1-image-to-video') {
    return generateKlingVideo(params);
  }

  if (params.videoModel?.startsWith('veo3-')) {
    return generateVeo3Video(params);
  }

  return generateSoraVideo(params);
}

async function generateSoraVideo(params: FalVideoParams): Promise<FalVideoResult> {
  const hasImage = !!params.imageUrl;
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
    input.image_url = params.imageUrl;
  }

  const result = await fal.subscribe(modelId, {
    input,
    timeout: 9 * 60 * 1000,
    onEnqueue: params.onEnqueue,
    onQueueUpdate: params.onQueueUpdate as any,
  } as any);
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
    requestId: result.requestId,
    model: modelId,
  };
}

async function generateKlingVideo(params: FalVideoParams): Promise<FalVideoResult> {
  const hasImage = !!params.imageUrl;
  const modelId = hasImage
    ? "fal-ai/kling-video/v2.1/standard/image-to-video"
    : "fal-ai/kling-video/v2.1/standard/text-to-video";

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
    input.image_url = params.imageUrl;
  }

  const result = await fal.subscribe(modelId, {
    input,
    timeout: 9 * 60 * 1000,
    onEnqueue: params.onEnqueue,
    onQueueUpdate: params.onQueueUpdate as any,
  } as any);
  const data = result.data as {
    video?: { url: string; content_type?: string };
  };

  if (!data.video?.url) {
    throw new Error("No video in kling response");
  }

  return {
    url: data.video.url,
    duration: durationNum,
    requestId: result.requestId,
    model: modelId,
  };
}

async function generateVeo3Video(params: FalVideoParams): Promise<FalVideoResult> {
  const hasImage = !!params.imageUrl;

  let modelId: string;
  if (params.videoModel === 'veo3-image-to-video') {
    modelId = 'fal-ai/veo3/image-to-video';
  } else if (params.videoModel === 'veo3-fast-text-to-video') {
    modelId = 'fal-ai/veo3/fast';
  } else {
    modelId = 'fal-ai/veo3';
  }

  // Veo 3 uses string durations like "4s", "6s", "8s"
  let durationStr: string;
  if (typeof params.duration === 'string') {
    durationStr = params.duration.endsWith('s') ? params.duration : `${params.duration}s`;
  } else {
    const num = params.duration ?? 8;
    durationStr = num <= 4 ? '4s' : num <= 6 ? '6s' : '8s';
  }

  const input: Record<string, unknown> = {
    prompt: params.prompt,
    duration: durationStr,
    aspect_ratio: params.aspectRatio || '16:9',
    resolution: '720p',
    generate_audio: true,
  };

  if (hasImage) {
    input.image_url = params.imageUrl;
  }

  const result = await fal.subscribe(modelId, {
    input,
    timeout: 10 * 60 * 1000,
    onEnqueue: params.onEnqueue,
    onQueueUpdate: params.onQueueUpdate as any,
  } as any);
  const data = result.data as {
    video?: { url: string; file_size?: number };
  };

  if (!data.video?.url) {
    throw new Error("No video in veo3 response");
  }

  const durationNum = parseInt(durationStr, 10);

  return {
    url: data.video.url,
    duration: durationNum,
    requestId: result.requestId,
    model: modelId,
  };
}
