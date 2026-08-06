import {
  createPikaMediaJob,
  fetchPikaCatalogQuote,
  getPikaMediaContent,
  pikaBillingBasis,
  waitForPikaMediaJob,
} from "@clash/shared-runtime";
import type { ModelKind, ModelUpstreamRoute } from "@clash/shared-types";

export interface PikaMediaGenerationInput {
  taskId: string;
  kind: ModelKind;
  route: ModelUpstreamRoute;
  prompt: string;
  aspectRatio?: string;
  duration?: number;
  modelParams?: Record<string, unknown>;
  startFrameUrl?: string;
  endFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  onUsageEvent?: (event: PikaUsageLifecycleEvent) => Promise<void>;
}

export interface PikaUsageLifecycleEvent {
  status: "submitted" | "completed" | "failed";
  operation: string;
  providerRequestId?: string;
  idempotencyKey: string;
  estimatedCostMicroUsd?: number;
  estimateComplete: boolean;
  pricingSource: "pika-catalog" | "unavailable";
  billingBasis: Record<string, unknown>;
  errorMessage?: string;
  occurredAt: string;
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function operation(input: PikaMediaGenerationInput): string {
  const { route } = input;
  const images = input.referenceImageUrls ?? [];
  if (route.modelCode === "pika-2.5") {
    return input.startFrameUrl || images.length
      ? "pika/pika-2.5/image-to-video"
      : "pika/pika-2.5/text-to-video";
  }
  if (route.modelCode === "flux-3-video") {
    return input.startFrameUrl || images.length
      ? "black-forest-labs/flux-3-video/image-to-video"
      : "black-forest-labs/flux-3-video/text-to-video";
  }
  if (route.modelCode === "kling-3") {
    return input.startFrameUrl || images.length
      ? "kling/kling-3.0/image-to-video"
      : "kling/kling-3.0/text-to-video";
  }
  if (input.kind === "image" && images.length) {
    return route.upstreamModel.replace(/\/text-to-image$/, "/image-to-image");
  }
  if (
    route.modelCode === "minimax-h3"
    && !images.length
    && !(input.referenceVideoUrls ?? []).length
    && !(input.referenceAudioUrls ?? []).length
  ) {
    return "minimax/h3/text-to-video";
  }
  return route.upstreamModel;
}

function requestBody(input: PikaMediaGenerationInput, selectedOperation: string): Record<string, unknown> {
  const params = input.modelParams ?? {};
  const images = input.referenceImageUrls ?? [];
  const videos = input.referenceVideoUrls ?? [];
  const audios = input.referenceAudioUrls ?? [];
  if (input.route.modelCode === "nano-banana-2") {
    return compact({
      prompt: input.prompt,
      num_images: params.count ?? 1,
      aspect_ratio: input.aspectRatio ?? params.aspect_ratio ?? "1:1",
      output_format: params.output_format ?? "png",
      resolution: params.resolution ?? "1K",
      image_urls: images.length ? images : undefined,
    });
  }
  if (input.route.modelCode === "gpt-image-2") {
    return compact({
      prompt: input.prompt,
      num_images: params.count ?? 1,
      aspect_ratio: input.aspectRatio,
      output_format: params.output_format ?? "png",
      resolution: params.resolution,
      quality: params.quality,
      background: params.background,
      size: params.size,
      image_urls: images.length ? images : undefined,
    });
  }
  if (input.route.modelCode === "seedream-5-pro" || input.route.modelCode === "recraft-v4") {
    return compact({
      prompt: input.prompt,
      num_images: params.count ?? 1,
      size: params.size,
      image_urls: images.length ? images : undefined,
    });
  }
  if (input.route.modelCode === "grok-imagine-quality") {
    return compact({
      prompt: input.prompt,
      num_images: params.count ?? 1,
      resolution: params.resolution ?? "2K",
      aspect_ratio: input.aspectRatio ?? "1:1",
      image_url: images[0],
    });
  }
  if (input.route.modelCode === "pika-2.5") {
    return compact({
      prompt: input.prompt,
      resolution: params.resolution ?? "720p",
      duration_s: input.duration ?? params.duration ?? 5,
      negative_prompt: params.negative_prompt,
      seed: params.seed,
      image: input.startFrameUrl ?? images[0],
    });
  }
  if (input.route.modelCode === "flux-3-video") {
    return compact({
      prompt: input.prompt,
      duration: input.duration ?? params.duration ?? "auto",
      resolution: params.resolution ?? "720p",
      aspect_ratio: input.aspectRatio ?? params.aspect_ratio ?? "auto",
      draft: params.mode === "draft",
      generate_audio: params.generate_audio ?? true,
      image_url: input.startFrameUrl ?? images[0],
    });
  }
  if (input.route.modelCode === "kling-3") {
    return compact({
      prompt: input.prompt,
      duration: Number(input.duration ?? params.duration ?? 5),
      resolution: params.resolution ?? "720p",
      aspect_ratio: input.aspectRatio ?? "16:9",
      audio: params.generate_audio === false ? "off" : "native",
      image_url: input.startFrameUrl ?? images[0],
      last_frame_url: input.endFrameUrl,
    });
  }
  if (input.route.modelCode === "grok-imagine-video-1.5") {
    return compact({
      prompt: input.prompt,
      duration: input.duration ?? params.duration ?? 6,
      image_url: input.startFrameUrl ?? images[0],
      aspect_ratio: input.aspectRatio,
      resolution: params.resolution ?? "720p",
    });
  }
  if (input.route.modelCode === "seedance-2-startend") {
    return compact({
      prompt: input.prompt,
      duration: input.duration ?? params.duration ?? "auto",
      ratio: input.aspectRatio ?? params.aspect_ratio,
      generate_audio: params.generate_audio,
      watermark: false,
      image_url: input.startFrameUrl ?? images[0],
      end_image_url: input.endFrameUrl,
      resolution: params.resolution ?? "720p",
    });
  }
  if (input.route.modelCode === "seedance-2-ref") {
    return compact({
      prompt: input.prompt,
      duration: input.duration ?? params.duration ?? "auto",
      ratio: input.aspectRatio ?? params.aspect_ratio,
      generate_audio: params.generate_audio,
      watermark: false,
      image_urls: images.length ? images : undefined,
      video_urls: videos.length ? videos : undefined,
      audio_urls: audios.length ? audios : undefined,
      resolution: params.resolution ?? "720p",
    });
  }
  if (input.route.modelCode === "minimax-h3" || input.route.modelCode === "minimax-h3-startend") {
    return compact({
      prompt: input.prompt,
      duration: input.duration ?? params.duration ?? 5,
      resolution: params.resolution ?? "2K",
      seed: params.seed,
      aigc_watermark: params.aigc_watermark,
      ratio: selectedOperation.endsWith("text-to-video") || selectedOperation.endsWith("reference-to-video")
        ? input.aspectRatio ?? params.aspect_ratio ?? (selectedOperation.endsWith("reference-to-video") ? "adaptive" : "16:9")
        : undefined,
      first_frame_image: input.startFrameUrl,
      last_frame_image: input.endFrameUrl,
      image_urls: images.length ? images : undefined,
      video_urls: videos.length ? videos : undefined,
      audio_urls: audios.length ? audios : undefined,
    });
  }
  if (input.route.modelCode === "minimax-music-3") {
    return compact({
      prompt: input.prompt,
      lyrics: params.lyrics,
      lyrics_optimizer: params.lyrics_optimizer ?? false,
      is_instrumental: params.is_instrumental ?? false,
      audio_setting: compact({
        sample_rate: params.sample_rate,
        bitrate: params.bitrate,
        format: params.format,
      }),
    });
  }
  if (input.route.modelCode === "lyria-3-pro") return { prompt: input.prompt };
  if (input.route.modelCode === "minimax-speech-2.8-hd") {
    return compact({
      text: input.prompt,
      voice_id: params.voice_id ?? "English_Graceful_Lady",
      speed: params.speed,
      vol: params.vol,
      pitch: params.pitch,
      emotion: params.emotion,
      sample_rate: params.sample_rate,
      bitrate: params.bitrate,
      format: params.format,
      channel: params.channel,
      language_boost: params.language_boost,
    });
  }
  throw new Error(`Pika API Club does not implement ${input.route.modelCode}`);
}

export async function generatePikaMedia(
  apiKey: string,
  input: PikaMediaGenerationInput,
): Promise<{ url: string; requestId: string; operation: string }> {
  const selectedOperation = operation(input);
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const idempotencyKey = input.taskId;
  const body = requestBody(input, selectedOperation);
  const quote = await fetchPikaCatalogQuote({
    operation: selectedOperation,
    input: body,
    baseUrl: input.baseUrl,
    fetch: fetchImpl,
  });
  const billingBasis = pikaBillingBasis(body);
  const emit = async (
    status: PikaUsageLifecycleEvent["status"],
    providerRequestId?: string,
    error?: unknown,
  ) => input.onUsageEvent?.({
    status,
    operation: selectedOperation,
    ...(providerRequestId ? { providerRequestId } : {}),
    idempotencyKey,
    ...(quote.estimatedCostMicroUsd !== undefined
      ? { estimatedCostMicroUsd: quote.estimatedCostMicroUsd }
      : {}),
    estimateComplete: quote.complete,
    pricingSource: quote.pricingSource,
    billingBasis,
    ...(error ? { errorMessage: error instanceof Error ? error.message : String(error) } : {}),
    occurredAt: new Date().toISOString(),
  });

  let created;
  try {
    created = await createPikaMediaJob({
      apiKey,
      operation: selectedOperation,
      input: body,
      idempotencyKey,
      baseUrl: input.baseUrl,
      fetch: fetchImpl,
    });
  } catch (error) {
    await emit("failed", undefined, error);
    throw error;
  }
  await emit("submitted", created.id);
  try {
    const completed = created.status === "completed"
      ? created
      : await waitForPikaMediaJob({
          apiKey,
          jobId: created.id,
          baseUrl: input.baseUrl,
          fetch: fetchImpl,
        });
    const content = await getPikaMediaContent({
      apiKey,
      jobId: completed.id,
      baseUrl: input.baseUrl,
      fetch: fetchImpl,
    });
    await emit("completed", completed.id);
    return { url: content.url, requestId: completed.id, operation: selectedOperation };
  } catch (error) {
    await emit("failed", created.id, error);
    throw error;
  }
}
