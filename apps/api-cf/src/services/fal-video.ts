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
  /** URL of source image (fal CDN URL, not base64). Single or startEnd.first. */
  imageUrl?: string;
  /** Tail/end frame URL (Kling 2.5/3, Seedance i2v with end_image_url). */
  tailImageUrl?: string;
  /** Multi-modal ref URLs (Seedance reference-to-video). */
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  duration?: number | string;
  aspectRatio?: string;
  videoModel?: string;
  /** Passthrough of ModelCard parameter selections (resolution, generate_audio, ...). */
  modelParams?: Record<string, unknown>;
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

  if (params.videoModel === 'kling-2.1') {
    return generateKlingVideo(params);
  }

  if (params.videoModel === 'kling-3') {
    return generateKling3Video(params);
  }

  if (params.videoModel === 'veo3' || params.videoModel === 'veo3-fast-text-to-video') {
    return generateVeo3Video(params);
  }

  if (params.videoModel === 'seedance-2-text' || params.videoModel === 'seedance-2-startend') {
    return generateSeedance2Video(params);
  }

  if (params.videoModel === 'seedance-2-ref') {
    return generateSeedance2RefVideo(params);
  }

  // Default: Sora 2 (id 'sora-2'). Provider-internal dispatch by hasImage.
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
    if (params.tailImageUrl) input.tail_image_url = params.tailImageUrl;
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

async function generateSeedance2Video(params: FalVideoParams): Promise<FalVideoResult> {
  const hasImage = !!params.imageUrl;
  // Provider-internal dispatch: same model id in our cards, two fal endpoints.
  const modelId = hasImage
    ? "bytedance/seedance-2.0/image-to-video"
    : "bytedance/seedance-2.0/text-to-video";

  // Seedance accepts `"auto"` (let the model pick) or an integer 4-15 for seconds.
  const rawDuration = params.duration ?? 'auto';
  const durationParam: string | number = rawDuration === 'auto'
    ? 'auto'
    : (typeof rawDuration === 'string' ? parseInt(rawDuration, 10) : rawDuration);

  const input: Record<string, unknown> = {
    prompt: params.prompt,
    duration: durationParam,
    resolution: (params.modelParams?.resolution as string) ?? '720p',
    generate_audio: (params.modelParams?.generate_audio as boolean) ?? true,
  };

  if (hasImage) {
    input.image_url = params.imageUrl;
    if (params.tailImageUrl) input.end_image_url = params.tailImageUrl;
  } else {
    // text-to-video takes aspect_ratio; image-to-video infers from the source image.
    input.aspect_ratio = params.aspectRatio || 'auto';
  }

  const result = await fal.subscribe(modelId, {
    input,
    timeout: 10 * 60 * 1000,
    onEnqueue: params.onEnqueue,
    onQueueUpdate: params.onQueueUpdate as any,
  } as any);
  const data = result.data as {
    video?: { url: string; duration?: number };
  };

  if (!data.video?.url) {
    throw new Error("No video in seedance-2 response");
  }

  const fallbackDuration = typeof durationParam === 'number' ? durationParam : 5;

  return {
    url: data.video.url,
    duration: data.video.duration ?? fallbackDuration,
    requestId: result.requestId,
    model: modelId,
  };
}

async function generateVeo3Video(params: FalVideoParams): Promise<FalVideoResult> {
  const hasImage = !!params.imageUrl;

  let modelId: string;
  if (params.videoModel === 'veo3-fast-text-to-video') {
    modelId = 'fal-ai/veo3/fast';
  } else if (hasImage) {
    modelId = 'fal-ai/veo3/image-to-video';
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

/**
 * Kling 3 Pro — image-to-video with start_image_url (required) + optional end_image_url.
 * This is the canonical startEnd model. No text-to-video on v3 yet.
 */
async function generateKling3Video(params: FalVideoParams): Promise<FalVideoResult> {
  if (!params.imageUrl) {
    throw new Error("Kling 3 Pro requires a start frame (image_url)");
  }

  const modelId = "fal-ai/kling-video/v3/pro/image-to-video";

  const durationStr = typeof params.duration === 'number'
    ? String(Math.min(Math.max(params.duration, 3), 15))
    : (params.duration ?? "5");
  const durationNum = parseInt(durationStr as string, 10);

  const input: Record<string, unknown> = {
    prompt: params.prompt,
    duration: durationStr,
    start_image_url: params.imageUrl,
    generate_audio: (params.modelParams?.generate_audio as boolean) ?? true,
  };
  if (params.tailImageUrl) input.end_image_url = params.tailImageUrl;

  const result = await fal.subscribe(modelId, {
    input,
    timeout: 10 * 60 * 1000,
    onEnqueue: params.onEnqueue,
    onQueueUpdate: params.onQueueUpdate as any,
  } as any);
  const data = result.data as { video?: { url: string; duration?: number } };
  if (!data.video?.url) throw new Error("No video in kling v3 response");

  return {
    url: data.video.url,
    duration: data.video.duration ?? durationNum,
    requestId: result.requestId,
    model: modelId,
  };
}

/**
 * Seedance 2.0 reference-to-video — separate endpoint that accepts up to
 * 9 image refs + 3 video refs + 3 audio refs (total ≤ 12). References are
 * positional in the prompt: "@Image1 @Video2 @Audio1".
 */
async function generateSeedance2RefVideo(params: FalVideoParams): Promise<FalVideoResult> {
  const modelId = "bytedance/seedance-2.0/reference-to-video";

  const rawDuration = params.duration ?? 'auto';
  const durationParam: string | number = rawDuration === 'auto'
    ? 'auto'
    : (typeof rawDuration === 'string' ? parseInt(rawDuration, 10) : rawDuration);

  const input: Record<string, unknown> = {
    prompt: params.prompt,
    duration: durationParam,
    resolution: (params.modelParams?.resolution as string) ?? '720p',
    aspect_ratio: params.aspectRatio || 'auto',
    generate_audio: (params.modelParams?.generate_audio as boolean) ?? true,
  };

  if (params.referenceImageUrls?.length) input.image_urls = params.referenceImageUrls;
  if (params.referenceVideoUrls?.length) input.video_urls = params.referenceVideoUrls;
  if (params.referenceAudioUrls?.length) input.audio_urls = params.referenceAudioUrls;

  const result = await fal.subscribe(modelId, {
    input,
    timeout: 10 * 60 * 1000,
    onEnqueue: params.onEnqueue,
    onQueueUpdate: params.onQueueUpdate as any,
  } as any);
  const data = result.data as { video?: { url: string; duration?: number } };
  if (!data.video?.url) throw new Error("No video in seedance-2-ref response");

  const fallbackDuration = typeof durationParam === 'number' ? durationParam : 5;
  return {
    url: data.video.url,
    duration: data.video.duration ?? fallbackDuration,
    requestId: result.requestId,
    model: modelId,
  };
}
