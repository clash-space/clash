import { resolveModelUpstreamRoute, type ModelKind } from "@clash/shared-types";

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

function resolveMockFalModelId(model: string, kind: ModelKind, fallback: string): string {
  const route = resolveModelUpstreamRoute({
    modelCode: model,
    kind,
    allowMock: true,
    configuredUpstreams: [{ upstreamId: "mock", enabled: true }],
  });
  return route?.upstreamModel ?? fallback;
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
      const modelEndpoint = resolveMockFalModelId(input.model, "image", "fal-ai/nano-banana-2");
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
      const modelEndpoint = resolveMockFalModelId(input.model, "video", "fal-ai/sora-2/text-to-video");
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
      const modelEndpoint = resolveMockFalModelId(input.model, "audio", "fal-ai/minimax/speech-02-hd");
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
