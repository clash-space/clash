import {
  resolveModelUpstreamRoute,
  type ModelKind,
  type ModelUpstreamRoute,
  type UpstreamAvailability,
} from "@clash/shared-types";

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
  modelParams?: Record<string, unknown>;
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
  variables?: () => Promise<Record<string, string | undefined>>;
  fetch?: typeof fetch;
  openAiBaseUrl?: string;
  falQueueBaseUrl?: string;
}

const LOCAL_UPSTREAM_ORDER: UpstreamAvailability["upstreamId"][] = [
  "openai",
  "fal",
  "mock",
];

function resolveMockFalModelId(model: string, kind: ModelKind, fallback: string): string {
  const route = resolveModelUpstreamRoute({
    modelCode: model,
    kind,
    allowMock: true,
    configuredUpstreams: [{ upstreamId: "mock", enabled: true }],
  });
  return route?.upstreamModel ?? fallback;
}

function availableVariableKeys(variables: Record<string, string | undefined>): string[] {
  return Object.entries(variables)
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([key]) => key);
}

function configuredUpstreamsForVariables(variables: Record<string, string | undefined>): UpstreamAvailability[] {
  const availableVariables = availableVariableKeys(variables);
  return LOCAL_UPSTREAM_ORDER.map((upstreamId) => ({
    upstreamId,
    enabled: true,
    availableVariables,
  }));
}

function resolveLocalRoute(
  model: string,
  kind: ModelKind,
  variables: Record<string, string | undefined>,
): ModelUpstreamRoute | null {
  return resolveModelUpstreamRoute({
    modelCode: model,
    kind,
    allowMock: true,
    configuredUpstreams: configuredUpstreamsForVariables(variables),
  });
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

function normalizeBaseUrl(baseUrl: string | undefined, fallback: string): string {
  return (baseUrl || fallback).replace(/\/+$/, "");
}

function stringParam(params: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = params?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberParam(params: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const value = params?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function outputFormat(params: Record<string, unknown> | undefined): "png" | "jpeg" | "webp" {
  const value = stringParam(params, "output_format");
  return value === "jpeg" || value === "webp" ? value : "png";
}

function mediaTypeForFormat(format: "png" | "jpeg" | "webp"): string {
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

function base64ToBytes(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, "base64"));
}

async function responseJson(response: Response): Promise<any> {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { error: { message: raw } };
  }
}

async function generateOpenAiImage(
  input: MockMediaGenerationInput,
  route: ModelUpstreamRoute,
  options: Required<Pick<MockFalExternalAigcServiceOptions, "fetch">> &
    Pick<MockFalExternalAigcServiceOptions, "openAiBaseUrl">,
  apiKey: string,
): Promise<MockMediaGenerationResult> {
  const format = outputFormat(input.modelParams);
  const body: Record<string, unknown> = {
    model: route.upstreamModel,
    prompt: input.prompt,
    n: Math.max(1, Math.min(10, numberParam(input.modelParams, "count", 1))),
  };
  for (const key of ["size", "quality", "background", "moderation"]) {
    const value = stringParam(input.modelParams, key);
    if (value) body[key] = value;
  }
  body.output_format = format;

  const response = await options.fetch(
    `${normalizeBaseUrl(options.openAiBaseUrl, "https://api.openai.com/v1")}/images/generations`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const json = await responseJson(response);
  if (!response.ok) {
    throw new Error(`OpenAI image request failed: ${json?.error?.message ?? response.statusText}`);
  }
  const b64 = json?.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || !b64) {
    throw new Error(`OpenAI image response returned no b64_json for ${route.upstreamModel}`);
  }
  return {
    bytes: base64ToBytes(b64),
    contentType: mediaTypeForFormat(format),
    requestId: typeof json.id === "string" ? json.id : input.taskId,
    provider: "openai",
    modelEndpoint: route.upstreamModel,
  };
}

function falInput(input: MockMediaGenerationInput, kind: ModelKind): Record<string, unknown> {
  if (kind === "image") {
    const params = input.modelParams ?? {};
    return {
      prompt: input.prompt,
      aspect_ratio: input.aspectRatio || stringParam(params, "aspect_ratio") || "16:9",
      image_size: stringParam(params, "image_size") || aspectRatioToFalImageSize(input.aspectRatio),
      output_format: stringParam(params, "output_format") || "png",
      num_images: Math.max(1, Math.min(4, numberParam(params, "count", 1))),
      ...(params.resolution ? { resolution: params.resolution } : {}),
      ...(params.num_inference_steps ? { num_inference_steps: params.num_inference_steps } : {}),
      ...(params.guidance_scale ? { guidance_scale: params.guidance_scale } : {}),
    };
  }
  if (kind === "video") {
    const params = input.modelParams ?? {};
    return {
      prompt: input.prompt,
      aspect_ratio: input.aspectRatio || stringParam(params, "aspect_ratio") || "16:9",
      duration: input.duration ?? params.duration ?? 4,
      ...(params.resolution ? { resolution: params.resolution } : {}),
      ...(params.generate_audio !== undefined ? { generate_audio: params.generate_audio } : {}),
    };
  }
  return {
    prompt: input.prompt,
    duration: input.duration ?? 5,
  };
}

function falMedia(result: any, kind: ModelKind): { url: string; width?: number; height?: number; durationMs?: number; waveform?: number[]; transcript?: string } {
  if (kind === "image") {
    const image = result?.images?.[0] ?? result?.image;
    if (!image?.url) throw new Error("No image URL in fal response");
    return { url: image.url, width: image.width, height: image.height };
  }
  if (kind === "video") {
    const video = result?.video;
    if (!video?.url) throw new Error("No video URL in fal response");
    return {
      url: video.url,
      width: video.width,
      height: video.height,
      durationMs: typeof video.duration === "number" ? Math.round(video.duration * 1000) : undefined,
      transcript: typeof result?.prompt === "string" ? result.prompt : undefined,
    };
  }
  const audio = result?.audio;
  if (!audio?.url) throw new Error("No audio URL in fal response");
  return {
    url: audio.url,
    durationMs: typeof audio.duration === "number" ? Math.round(audio.duration * 1000) : undefined,
    waveform: Array.isArray(result?.waveform) ? result.waveform : undefined,
    transcript: typeof result?.transcript === "string" ? result.transcript : undefined,
  };
}

async function generateFalMedia(
  input: MockMediaGenerationInput,
  kind: ModelKind,
  route: ModelUpstreamRoute,
  options: Required<Pick<MockFalExternalAigcServiceOptions, "fetch">> &
    Pick<MockFalExternalAigcServiceOptions, "falQueueBaseUrl">,
  apiKey: string,
): Promise<MockMediaGenerationResult> {
  const queueBaseUrl = normalizeBaseUrl(options.falQueueBaseUrl, "https://queue.fal.run");
  const endpoint = route.upstreamModel.replace(/^\/+/, "");
  const headers = {
    authorization: `Key ${apiKey}`,
    "content-type": "application/json",
  };
  const submittedResponse = await options.fetch(`${queueBaseUrl}/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(falInput(input, kind)),
  });
  const submitted = await responseJson(submittedResponse);
  if (!submittedResponse.ok) {
    throw new Error(`fal request failed: ${submitted?.detail ?? submitted?.error?.message ?? submittedResponse.statusText}`);
  }
  const requestId = submitted.request_id ?? submitted.requestId;
  if (typeof requestId !== "string" || !requestId) {
    throw new Error("fal response returned no request_id");
  }

  let status = "IN_QUEUE";
  for (let attempt = 0; attempt < 240 && status !== "COMPLETED"; attempt += 1) {
    const statusResponse = await options.fetch(`${queueBaseUrl}/${endpoint}/requests/${encodeURIComponent(requestId)}/status`, {
      headers: { authorization: `Key ${apiKey}` },
    });
    const statusJson = await responseJson(statusResponse);
    if (!statusResponse.ok) {
      throw new Error(`fal status failed: ${statusJson?.detail ?? statusJson?.error?.message ?? statusResponse.statusText}`);
    }
    status = statusJson.status;
    if (status === "FAILED" || status === "ERROR") {
      throw new Error(`fal request failed: ${statusJson.error ?? status}`);
    }
    if (status !== "COMPLETED") await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (status !== "COMPLETED") throw new Error(`fal request timed out: ${requestId}`);

  const resultResponse = await options.fetch(`${queueBaseUrl}/${endpoint}/requests/${encodeURIComponent(requestId)}`, {
    headers: { authorization: `Key ${apiKey}` },
  });
  const resultJson = await responseJson(resultResponse);
  if (!resultResponse.ok) {
    throw new Error(`fal result failed: ${resultJson?.detail ?? resultJson?.error?.message ?? resultResponse.statusText}`);
  }

  const media = falMedia(resultJson?.data ?? resultJson, kind);
  const mediaResponse = await options.fetch(media.url);
  if (!mediaResponse.ok) throw new Error(`fal media download failed: ${mediaResponse.status}`);
  return {
    bytes: new Uint8Array(await mediaResponse.arrayBuffer()),
    contentType: mediaResponse.headers.get("content-type") ?? (kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "image/png"),
    width: media.width,
    height: media.height,
    durationMs: media.durationMs,
    waveform: media.waveform,
    transcript: media.transcript,
    requestId,
    provider: "fal",
    modelEndpoint: route.upstreamModel,
    remoteUrl: media.url,
  };
}

function missingAdapter(route: ModelUpstreamRoute): Error {
  return new Error(
    `Local provider adapter is not implemented for ${route.upstreamId} (${route.apiShape}). ` +
      `Use a fal/OpenAI-routed model in the desktop app for now.`,
  );
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
  const fetchImpl = options.fetch ?? fetch;
  const loadVariables: () => Promise<Record<string, string | undefined>> =
    options.variables ?? (async () => ({}));

  async function generateWithRoute(
    input: MockMediaGenerationInput,
    kind: ModelKind,
    fallback: () => Promise<MockMediaGenerationResult>,
  ): Promise<MockMediaGenerationResult> {
    const variables = await loadVariables();
    const route = resolveLocalRoute(input.model, kind, variables);
    if (!route || route.upstreamId === "mock") return fallback();

    if (route.apiShape === "openai-images") {
      const apiKey = variables.OPENAI_API_KEY?.trim();
      if (!apiKey) return fallback();
      return generateOpenAiImage(input, route, {
        fetch: fetchImpl,
        openAiBaseUrl: options.openAiBaseUrl,
      }, apiKey);
    }

    if (route.apiShape === "fal") {
      const apiKey = variables.FAL_API_KEY?.trim();
      if (!apiKey) return fallback();
      return generateFalMedia(input, kind, route, {
        fetch: fetchImpl,
        falQueueBaseUrl: options.falQueueBaseUrl,
      }, apiKey);
    }

    throw missingAdapter(route);
  }

  return {
    async generateImage(input) {
      return generateWithRoute(input, "image", async () => {
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
      });
    },

    async generateVideo(input) {
      return generateWithRoute(input, "video", async () => {
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
      });
    },

    async generateAudio(input) {
      return generateWithRoute(input, "audio", async () => {
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
      });
    },
  };
}
