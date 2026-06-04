import {
  createMockFalQueueService,
  type FalAudioResult,
  type FalImageResult,
  type FalMockQueueService,
  type FalMockResult,
  type FalVideoResult,
} from "./fal-mock.js";

export interface MockMediaGenerationInput {
  taskId: string;
  prompt: string;
  model: string;
  aspectRatio?: string;
  duration?: number;
}

export interface MockMediaGenerationResult {
  bytes: Uint8Array;
  contentType: string;
  width?: number;
  height?: number;
  durationMs?: number;
  waveform?: number[];
  transcript?: string;
  requestId?: string;
  provider?: string;
  modelEndpoint?: string;
  remoteUrl?: string;
}

export interface ExternalAigcService {
  generateImage(input: MockMediaGenerationInput): Promise<MockMediaGenerationResult>;
  generateVideo(input: MockMediaGenerationInput): Promise<MockMediaGenerationResult>;
  generateAudio(input: MockMediaGenerationInput): Promise<MockMediaGenerationResult>;
}

export interface MockFalExternalAigcServiceOptions {
  fal?: FalMockQueueService;
  origin?: string;
}

const FAL_IMAGE_MODEL_IDS: Record<string, string> = {
  "flux-schnell": "fal-ai/flux/schnell",
  "flux-dev": "fal-ai/flux/dev",
  "nano-banana-2": "fal-ai/nano-banana-2",
  "nano-banana-2-edit": "fal-ai/nano-banana-2/edit",
  "recraft-v4": "fal-ai/recraft/v4/pro/text-to-image",
  "flux-2-pro": "fal-ai/flux-2-pro",
  "flux-2-pro-edit": "fal-ai/flux-2-pro/edit",
  "gemini-flash-image-2": "fal-ai/nano-banana-2",
};

const FAL_VIDEO_MODEL_IDS: Record<string, string> = {
  "sora-2": "fal-ai/sora-2/text-to-video",
  "kling-2.1": "fal-ai/kling-video/v2.1/standard/text-to-video",
  "kling-3": "fal-ai/kling-video/v3/pro/image-to-video",
  "veo3": "fal-ai/veo3",
  "veo3-fast-text-to-video": "fal-ai/veo3/fast",
  "seedance-2-text": "bytedance/seedance-2.0/text-to-video",
  "seedance-2-startend": "bytedance/seedance-2.0/image-to-video",
  "seedance-2-ref": "bytedance/seedance-2.0/reference-to-video",
};

const FAL_AUDIO_MODEL_IDS: Record<string, string> = {
  "gemini-3.1-flash-tts": "fal-ai/minimax/speech-02-hd",
  "gemini-3.1-pro-tts": "fal-ai/minimax/speech-02-hd",
  "minimax-speech-02-hd": "fal-ai/minimax/speech-02-hd",
};

function resolveFalModelId(model: string, table: Record<string, string>, fallback: string): string {
  if (model.startsWith("fal-ai/") || model.startsWith("bytedance/")) return model;
  return table[model] ?? fallback;
}

function aspectRatioToFalImageSize(aspectRatio: string | undefined): string {
  const map: Record<string, string> = {
    "16:9": "landscape_16_9",
    "9:16": "portrait_16_9",
    "1:1": "square_hd",
    "4:3": "landscape_4_3",
    "3:4": "portrait_4_3",
  };
  return map[aspectRatio ?? "16:9"] ?? "landscape_16_9";
}

function hasImages(result: FalMockResult): result is FalImageResult {
  return "images" in result;
}

function hasVideo(result: FalMockResult): result is FalVideoResult {
  return "video" in result;
}

function hasAudio(result: FalMockResult): result is FalAudioResult {
  return "audio" in result;
}

async function waitForFalResult(
  fal: FalMockQueueService,
  modelEndpoint: string,
  requestId: string,
  origin: string | undefined,
): Promise<FalMockResult> {
  let status = fal.status(modelEndpoint, requestId, { logs: true, origin });
  for (let attempt = 0; attempt < 8 && status?.status !== "COMPLETED"; attempt += 1) {
    status = fal.status(modelEndpoint, requestId, { logs: true, origin });
  }
  if (status?.status !== "COMPLETED") {
    throw new Error(`Mock fal request did not complete: ${requestId}`);
  }

  const result = fal.result(modelEndpoint, requestId, { origin });
  if (!result) throw new Error(`Mock fal result missing: ${requestId}`);
  return result;
}

function mediaForRequest(fal: FalMockQueueService, requestId: string) {
  const media = fal.media(requestId);
  if (!media) throw new Error(`Mock fal media missing: ${requestId}`);
  return media;
}

export function createMockExternalAigcService(
  options: MockFalExternalAigcServiceOptions = {},
): ExternalAigcService {
  const fal = options.fal ?? createMockFalQueueService();

  return {
    async generateImage(input) {
      const modelEndpoint = resolveFalModelId(input.model, FAL_IMAGE_MODEL_IDS, "fal-ai/nano-banana-2");
      const submitted = await fal.submit(modelEndpoint, {
        prompt: input.prompt || "Mock fal image",
        image_size: aspectRatioToFalImageSize(input.aspectRatio),
        output_format: "png",
        output_type: "image",
      }, { origin: options.origin });
      const result = await waitForFalResult(fal, modelEndpoint, submitted.request_id, options.origin);
      if (!hasImages(result) || !result.images[0]) throw new Error("No images in mock fal response");
      const media = mediaForRequest(fal, submitted.request_id);
      return {
        bytes: media.bytes,
        contentType: media.contentType,
        width: result.images[0].width,
        height: result.images[0].height,
        requestId: submitted.request_id,
        provider: "fal-mock",
        modelEndpoint,
        remoteUrl: result.images[0].url,
      };
    },

    async generateVideo(input) {
      const modelEndpoint = resolveFalModelId(input.model, FAL_VIDEO_MODEL_IDS, "fal-ai/sora-2/text-to-video");
      const submitted = await fal.submit(modelEndpoint, {
        prompt: input.prompt || "Mock fal video",
        aspect_ratio: input.aspectRatio || "16:9",
        duration: input.duration ?? 4,
        output_type: "video",
      }, { origin: options.origin });
      const result = await waitForFalResult(fal, modelEndpoint, submitted.request_id, options.origin);
      if (!hasVideo(result)) throw new Error("No video in mock fal response");
      const media = mediaForRequest(fal, submitted.request_id);
      return {
        bytes: media.bytes,
        contentType: media.contentType,
        width: result.video.width,
        height: result.video.height,
        durationMs: Math.round(result.video.duration * 1000),
        transcript: result.prompt,
        requestId: submitted.request_id,
        provider: "fal-mock",
        modelEndpoint,
        remoteUrl: result.video.url,
      };
    },

    async generateAudio(input) {
      const modelEndpoint = resolveFalModelId(input.model, FAL_AUDIO_MODEL_IDS, "fal-ai/minimax/speech-02-hd");
      const submitted = await fal.submit(modelEndpoint, {
        prompt: input.prompt || "Mock fal audio",
        duration: input.duration ?? 5,
        output_type: "audio",
      }, { origin: options.origin });
      const result = await waitForFalResult(fal, modelEndpoint, submitted.request_id, options.origin);
      if (!hasAudio(result)) throw new Error("No audio in mock fal response");
      const media = mediaForRequest(fal, submitted.request_id);
      return {
        bytes: media.bytes,
        contentType: media.contentType,
        durationMs: Math.round(result.audio.duration * 1000),
        waveform: result.waveform,
        transcript: result.transcript,
        requestId: submitted.request_id,
        provider: "fal-mock",
        modelEndpoint,
        remoteUrl: result.audio.url,
      };
    },
  };
}
