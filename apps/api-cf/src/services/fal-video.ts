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
import { resolveFlux3KeyframeIndices } from "@clash/shared-runtime";

interface FalVideoParams {
  prompt: string;
  /** startEnd: first frame anchor (fal CDN URL). */
  startFrameUrl?: string;
  /** startEnd: last frame anchor (fal CDN URL). */
  endFrameUrl?: string;
  /** Flat list of reference images. i2v dispatchers (Sora 2, Kling 2.1, veo3)
   *  use [0] as their single source frame; multi-ref dispatchers
   *  (Seedance ref-to-video) consume the whole list. */
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  duration?: number | string;
  aspectRatio?: string;
  videoModel?: string;
  /** Exact endpoint selected by the model-provider route. */
  modelEndpoint?: string;
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

  if (params.videoModel?.startsWith('flux-3-video')) {
    return generateFlux3Video(params);
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

  if (params.videoModel === 'minimax-h3' || params.videoModel === 'minimax-h3-startend') {
    return generateMiniMaxH3Video(params);
  }

  if (params.videoModel === 'sora-2') {
    return generateSoraVideo(params);
  }

  throw new Error(`Unsupported fal video model: ${params.videoModel ?? params.modelEndpoint ?? "missing model"}`);
}

async function generateFlux3Video(params: FalVideoParams): Promise<FalVideoResult> {
  const duration = params.duration ?? "auto";
  const common: Record<string, unknown> = {
    prompt: params.prompt,
    duration,
    aspect_ratio: params.aspectRatio || "auto",
    resolution: (params.modelParams?.resolution as string | undefined) ?? "720p",
    generate_audio: (params.modelParams?.generate_audio as boolean | undefined) ?? true,
    safety_tolerance: (params.modelParams?.safety_tolerance as number | undefined) ?? 2,
  };

  let modelId: string;
  let input: Record<string, unknown> = common;
  if (params.videoModel === "flux-3-video-continue") {
    const videoUrl = params.referenceVideoUrls?.[0];
    if (!videoUrl) throw new Error("FLUX 3 continuation requires one source video.");
    modelId = "blackforestlabs/flux-3/extend-video";
    input = { ...common, video_url: videoUrl };
  } else if (params.videoModel === "flux-3-video-keyframes") {
    const images = params.referenceImageUrls ?? [];
    if (images.length === 0) throw new Error("FLUX 3 keyframe generation requires at least one image.");
    if (images.length > 10) throw new Error("FLUX 3 accepts at most 10 keyframes.");
    if (images.length === 1) {
      modelId = "blackforestlabs/flux-3/image-to-video";
      input = { ...common, image_url: images[0] };
    } else if (images.length === 2) {
      modelId = "blackforestlabs/flux-3/first-last-frame-to-video";
      input = { ...common, start_image_url: images[0], end_image_url: images[1] };
    } else {
      const numericDuration = typeof duration === "number" ? duration : Number.parseInt(duration, 10);
      if (!Number.isFinite(numericDuration)) {
        throw new Error("FLUX 3 multi-keyframe generation requires an explicit duration.");
      }
      const frameIndices = resolveFlux3KeyframeIndices(params.modelParams, images.length, numericDuration);
      modelId = "blackforestlabs/flux-3/keyframes-to-video";
      input = {
        ...common,
        keyframes: images.map((imageUrl, index) => ({
          image_url: imageUrl,
          frame_index: frameIndices[index],
        })),
      };
    }
  } else {
    modelId = "blackforestlabs/flux-3/text-to-video";
  }

  const result = await fal.subscribe(modelId, {
    input,
    timeout: 30 * 60 * 1000,
    onEnqueue: params.onEnqueue,
    onQueueUpdate: params.onQueueUpdate as any,
  } as any);
  const data = result.data as { video?: { url: string; duration?: number } };
  if (!data.video?.url) throw new Error("No video in FLUX 3 response");
  return {
    url: data.video.url,
    duration: data.video.duration ?? (typeof duration === "number" ? duration : 5),
    requestId: result.requestId,
    model: modelId,
  };
}

async function generateMiniMaxH3Video(params: FalVideoParams): Promise<FalVideoResult> {
  const duration = typeof params.duration === "string"
    ? Number.parseInt(params.duration, 10)
    : (params.duration ?? 5);
  const resolution = (params.modelParams?.resolution as string | undefined) ?? "768P";
  const input: Record<string, unknown> = {
    prompt: params.prompt,
    duration,
    resolution,
  };

  let modelId: string;
  if (params.videoModel === "minimax-h3-startend") {
    if (!params.startFrameUrl) {
      throw new Error("MiniMax H3 start/end generation requires a start frame");
    }
    modelId = "minimax/h3/image-to-video";
    input.image_url = params.startFrameUrl;
    if (params.endFrameUrl) input.end_image_url = params.endFrameUrl;
  } else {
    const hasReferences = Boolean(
      params.referenceImageUrls?.length
      || params.referenceVideoUrls?.length
      || params.referenceAudioUrls?.length,
    );
    modelId = hasReferences
      ? "minimax/h3/reference-to-video"
      : "minimax/h3/text-to-video";
    if (!hasReferences && params.aspectRatio === "adaptive") {
      throw new Error("MiniMax H3 Auto aspect ratio on fal requires at least one reference");
    }
    input.aspect_ratio = params.aspectRatio || "16:9";
    if (params.referenceImageUrls?.length) input.reference_image_urls = params.referenceImageUrls;
    if (params.referenceVideoUrls?.length) input.reference_video_urls = params.referenceVideoUrls;
    if (params.referenceAudioUrls?.length) input.reference_audio_urls = params.referenceAudioUrls;
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
    throw new Error("No video in MiniMax H3 response");
  }

  return {
    url: data.video.url,
    duration: data.video.duration ?? duration,
    requestId: result.requestId,
    model: modelId,
  };
}

async function generateSoraVideo(params: FalVideoParams): Promise<FalVideoResult> {
  // Sora 2 is i2v — single source frame comes from referenceImageUrls[0].
  const sourceImageUrl = params.referenceImageUrls?.[0];
  const hasImage = !!sourceImageUrl;
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
    input.image_url = sourceImageUrl;
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
  // Kling 2.1 is i2v — single source frame comes from referenceImageUrls[0].
  const sourceImageUrl = params.referenceImageUrls?.[0];
  const hasImage = !!sourceImageUrl;
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
    input.image_url = sourceImageUrl;
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
  // seedance-2-text uses no frames; seedance-2-startend uses startFrame + endFrame.
  // Both share this dispatcher; presence of startFrameUrl decides the endpoint.
  const hasImage = !!params.startFrameUrl;
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
  const seed = params.modelParams?.seed;
  if (typeof seed === "number" && Number.isFinite(seed)) input.seed = seed;

  if (hasImage) {
    input.image_url = params.startFrameUrl;
    if (params.endFrameUrl) input.end_image_url = params.endFrameUrl;
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
  // veo3 is i2v — single source frame from referenceImageUrls[0].
  // veo3-fast-text-to-video is text-only.
  const sourceImageUrl = params.referenceImageUrls?.[0];
  const hasImage = !!sourceImageUrl;

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
    input.image_url = sourceImageUrl;
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
  if (!params.startFrameUrl) {
    throw new Error("Kling 3 Pro requires a start frame");
  }

  const modelId = "fal-ai/kling-video/v3/pro/image-to-video";

  const durationStr = typeof params.duration === 'number'
    ? String(Math.min(Math.max(params.duration, 3), 15))
    : (params.duration ?? "5");
  const durationNum = parseInt(durationStr as string, 10);

  const input: Record<string, unknown> = {
    prompt: params.prompt,
    duration: durationStr,
    start_image_url: params.startFrameUrl,
    generate_audio: (params.modelParams?.generate_audio as boolean) ?? true,
  };
  if (params.endFrameUrl) input.end_image_url = params.endFrameUrl;

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
  const seed = params.modelParams?.seed;
  if (typeof seed === "number" && Number.isFinite(seed)) input.seed = seed;

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
