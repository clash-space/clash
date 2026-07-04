import {
  normalizeModelId,
  resolveModelUpstreamRoute,
  type ModelKind,
  type ModelUpstreamRoute,
  type ProviderAccountAvailability,
} from "@clash/shared-types";
import { generateTextCompletion } from "@clash/shared-runtime";

import {
  createMockFalQueueService,
  type FalAudioResult,
  type FalImageResult,
  type FalMockQueueService,
  type FalMockResult,
  type FalVideoResult,
} from "./fal-mock.js";
import { generateDreaminaCliVideoMedia, type DreaminaCliRun } from "./dreamina-cli.js";

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

export interface MockTextGenerationResult {
  text: string;
  provider?: string;
  modelEndpoint?: string;
}

export interface ExternalAigcService {
  generateImage(input: MockMediaGenerationInput): Promise<MockMediaGenerationResult>;
  generateVideo(input: MockMediaGenerationInput): Promise<MockMediaGenerationResult>;
  generateAudio(input: MockMediaGenerationInput): Promise<MockMediaGenerationResult>;
  generateText(input: MockMediaGenerationInput): Promise<MockTextGenerationResult>;
}

export interface MockFalExternalAigcServiceOptions {
  fal?: FalMockQueueService;
  origin?: string;
  providerAccounts?: () => Promise<RuntimeProviderAccountAvailability[]>;
  fetch?: typeof fetch;
  openAiBaseUrl?: string;
  anthropicBaseUrl?: string;
  falQueueBaseUrl?: string;
  googleAiStudioBaseUrl?: string;
  kieBaseUrl?: string;
  replicateBaseUrl?: string;
  dreaminaRun?: DreaminaCliRun;
}

type RuntimeProviderAccountAvailability = ProviderAccountAvailability & {
  credentials?: Record<string, string>;
};

function resolveMockFalModelId(model: string, kind: ModelKind, fallback: string): string {
  const route = resolveModelUpstreamRoute({
    modelCode: model,
    kind,
    allowMock: true,
    configuredUpstreams: [{ upstreamId: "mock", enabled: true }],
  });
  return route?.upstreamModel ?? fallback;
}

function resolveLocalRoute(
  model: string,
  kind: ModelKind,
  providerAccounts?: RuntimeProviderAccountAvailability[],
): ModelUpstreamRoute | null {
  if (providerAccounts) {
    return resolveModelUpstreamRoute({
      modelCode: model,
      kind,
      allowMock: true,
      configuredProviders: [
        ...providerAccounts,
        { providerId: "mock", enabled: true },
      ],
    });
  }
  return resolveModelUpstreamRoute({
    modelCode: model,
    kind,
    allowMock: true,
    configuredUpstreams: [{ upstreamId: "mock", enabled: true }],
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

function googleAiStudioBody(input: MockMediaGenerationInput, kind: ModelKind): Record<string, unknown> {
  const params = input.modelParams ?? {};
  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: input.prompt }] }],
  };
  if (kind === "image") {
    body.generationConfig = {
      responseModalities: ["TEXT", "IMAGE"],
      responseFormat: {
        image: {
          aspectRatio: input.aspectRatio || stringParam(params, "aspect_ratio") || "1:1",
          imageSize: stringParam(params, "resolution") || stringParam(params, "image_size") || "1K",
        },
      },
    };
    return body;
  }
  if (kind === "audio") {
    body.generationConfig = {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: stringParam(params, "voice_name") || "Kore",
          },
        },
      },
    };
    return body;
  }
  return body;
}

function googleInlineData(json: any): { data: string; mimeType: string } | null {
  const parts = json?.candidates?.flatMap((candidate: any) => candidate?.content?.parts ?? []) ?? [];
  for (const part of parts) {
    const inlineData = part?.inlineData ?? part?.inline_data;
    const data = inlineData?.data;
    if (typeof data === "string" && data) {
      return {
        data,
        mimeType: inlineData?.mimeType ?? inlineData?.mime_type ?? "application/octet-stream",
      };
    }
  }
  return null;
}

async function generateGoogleAiStudioMedia(
  input: MockMediaGenerationInput,
  kind: ModelKind,
  route: ModelUpstreamRoute,
  options: Required<Pick<MockFalExternalAigcServiceOptions, "fetch">> &
    Pick<MockFalExternalAigcServiceOptions, "googleAiStudioBaseUrl">,
  apiKey: string,
): Promise<MockMediaGenerationResult> {
  if (kind !== "image" && kind !== "audio") throw missingAdapter(route);
  const baseUrl = normalizeBaseUrl(options.googleAiStudioBaseUrl, "https://generativelanguage.googleapis.com/v1beta");
  const response = await options.fetch(`${baseUrl}/models/${route.upstreamModel}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify(googleAiStudioBody(input, kind)),
  });
  const json = await responseJson(response);
  if (!response.ok) {
    throw new Error(`Google AI Studio request failed: ${json?.error?.message ?? response.statusText}`);
  }
  const inlineData = googleInlineData(json);
  if (!inlineData) {
    throw new Error(`Google AI Studio response returned no inline media for ${route.upstreamModel}`);
  }
  return {
    bytes: base64ToBytes(inlineData.data),
    contentType: inlineData.mimeType,
    requestId: input.taskId,
    provider: "google",
    modelEndpoint: route.upstreamModel,
  };
}

interface GoogleAgentPlatformCredentials {
  clientEmail: string;
  privateKey: string;
  project: string;
  location?: string;
}

const GOOGLE_VERTEX_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_VERTEX_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

function parseGoogleAgentPlatformCredentials(raw: string): GoogleAgentPlatformCredentials {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("Google Cloud Agent Platform credentials must be a service account JSON object.");
  }
  const clientEmail = stringParam(parsed, "clientEmail") || stringParam(parsed, "client_email");
  const privateKey = stringParam(parsed, "privateKey") || stringParam(parsed, "private_key");
  const project = stringParam(parsed, "project") || stringParam(parsed, "project_id");
  const location = stringParam(parsed, "location");
  if (!clientEmail || !privateKey || !project) {
    throw new Error("Google Cloud Agent Platform credentials must include clientEmail/privateKey/project.");
  }
  return { clientEmail, privateKey, project, ...(location ? { location } : {}) };
}

function base64Url(value: string | ArrayBuffer): string {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importGooglePrivateKey(privateKey: string): Promise<CryptoKey> {
  const normalized = privateKey.replace(/\\n/g, "\n");
  const body = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Buffer.from(body, "base64");
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function signedGoogleJwt(credentials: GoogleAgentPlatformCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: credentials.clientEmail,
    scope: GOOGLE_VERTEX_SCOPE,
    aud: GOOGLE_VERTEX_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const privateKey = await importGooglePrivateKey(credentials.privateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64Url(signature)}`;
}

async function googleVertexAccessToken(
  credentials: GoogleAgentPlatformCredentials,
  fetchImpl: typeof fetch,
): Promise<string> {
  const jwt = await signedGoogleJwt(credentials);
  const response = await fetchImpl(GOOGLE_VERTEX_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  const json = await responseJson(response);
  if (!response.ok) {
    throw new Error(`Google Cloud Agent Platform token exchange failed: ${json?.error_description ?? json?.error ?? response.statusText}`);
  }
  if (typeof json.access_token !== "string" || !json.access_token) {
    throw new Error("Google Cloud Agent Platform token exchange returned no access_token.");
  }
  return json.access_token;
}

function vertexBaseHost(location: string): string {
  return location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
}

function googleAgentPlatformTextBody(input: MockMediaGenerationInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: input.prompt }] }],
  };
  const systemPrompt = stringParam(input.modelParams, "system_prompt");
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };
  return body;
}

function googleText(json: any): string | null {
  const parts = json?.candidates?.flatMap((candidate: any) => candidate?.content?.parts ?? []) ?? [];
  const text = parts
    .map((part: any) => typeof part?.text === "string" ? part.text : "")
    .join("");
  return text ? text : null;
}

async function generateGoogleAgentPlatformText(
  input: MockMediaGenerationInput,
  route: ModelUpstreamRoute,
  fetchImpl: typeof fetch,
  rawCredentials: string,
): Promise<MockMediaGenerationResult> {
  const credentials = parseGoogleAgentPlatformCredentials(rawCredentials);
  const location = credentials.location || route.region || "global";
  const token = await googleVertexAccessToken(credentials, fetchImpl);
  const response = await fetchImpl(
    `https://${vertexBaseHost(location)}/v1/projects/${credentials.project}/locations/${location}/publishers/google/models/${route.upstreamModel}:generateContent`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(googleAgentPlatformTextBody(input)),
    },
  );
  const json = await responseJson(response);
  if (!response.ok) {
    throw new Error(`Google Cloud Agent Platform text request failed: ${json?.error?.message ?? response.statusText}`);
  }
  const text = googleText(json);
  if (!text) {
    throw new Error(`Google Cloud Agent Platform response returned no text for ${route.upstreamModel}.`);
  }
  return {
    bytes: new TextEncoder().encode(text),
    contentType: "text/plain; charset=utf-8",
    requestId: input.taskId,
    provider: "google-agent-platform",
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

function providerInput(input: MockMediaGenerationInput, kind: ModelKind): Record<string, unknown> {
  const params = input.modelParams ?? {};
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    ...params,
  };
  if (input.aspectRatio) body.aspect_ratio = input.aspectRatio;
  if (kind === "video") {
    body.duration = input.duration ?? params.duration ?? 5;
  }
  return body;
}

function firstResultUrl(value: unknown): string | undefined {
  if (typeof value === "string") {
    return /^https?:\/\//i.test(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstResultUrl(item);
      if (url) return url;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of [
    "resultUrls",
    "fullResultUrls",
    "originUrls",
    "output",
    "images",
    "videos",
    "audios",
    "image",
    "video",
    "audio",
    "url",
    "uri",
    "response",
    "data",
  ]) {
    const url = firstResultUrl(record[key]);
    if (url) return url;
  }
  return undefined;
}

function defaultContentType(kind: ModelKind): string {
  if (kind === "video") return "video/mp4";
  if (kind === "audio") return "audio/mpeg";
  return "image/png";
}

async function downloadProviderMedia(
  fetchImpl: typeof fetch,
  mediaUrl: string,
  kind: ModelKind,
): Promise<Pick<MockMediaGenerationResult, "bytes" | "contentType" | "remoteUrl">> {
  const mediaResponse = await fetchImpl(mediaUrl);
  if (!mediaResponse.ok) throw new Error(`provider media download failed: ${mediaResponse.status}`);
  return {
    bytes: new Uint8Array(await mediaResponse.arrayBuffer()),
    contentType: mediaResponse.headers.get("content-type") ?? defaultContentType(kind),
    remoteUrl: mediaUrl,
  };
}

function kieTaskState(data: any): "pending" | "success" | "failed" {
  const task = data?.data ?? data;
  const flag = task?.successFlag;
  if (flag === 1 || flag === "1") return "success";
  if (flag === 2 || flag === 3 || flag === "2" || flag === "3") return "failed";
  const state = String(task?.state ?? task?.status ?? task?.taskStatus ?? "").toLowerCase();
  if (state === "success" || state === "succeeded" || state === "completed") return "success";
  if (state === "fail" || state === "failed" || state === "error" || state === "canceled") return "failed";
  return "pending";
}

async function generateKieMedia(
  input: MockMediaGenerationInput,
  kind: ModelKind,
  route: ModelUpstreamRoute,
  options: Required<Pick<MockFalExternalAigcServiceOptions, "fetch">> &
    Pick<MockFalExternalAigcServiceOptions, "kieBaseUrl">,
  apiKey: string,
): Promise<MockMediaGenerationResult> {
  const baseUrl = normalizeBaseUrl(options.kieBaseUrl, "https://api.kie.ai");
  const headers = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };
  const createResponse = await options.fetch(`${baseUrl}/api/v1/jobs/createTask`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: route.upstreamModel,
      input: providerInput(input, kind),
    }),
  });
  const created = await responseJson(createResponse);
  if (!createResponse.ok || created?.code >= 400) {
    throw new Error(`KIE request failed: ${created?.msg ?? created?.error?.message ?? createResponse.statusText}`);
  }
  const taskId = created?.data?.taskId ?? created?.taskId ?? created?.id;
  if (typeof taskId !== "string" || !taskId) {
    throw new Error(`KIE response returned no taskId for ${route.upstreamModel}`);
  }

  let task: any = null;
  let state: "pending" | "success" | "failed" = "pending";
  for (let attempt = 0; attempt < 240 && state === "pending"; attempt += 1) {
    const statusResponse = await options.fetch(`${baseUrl}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    task = await responseJson(statusResponse);
    if (!statusResponse.ok || task?.code >= 400) {
      throw new Error(`KIE status failed: ${task?.msg ?? task?.error?.message ?? statusResponse.statusText}`);
    }
    state = kieTaskState(task);
    if (state === "pending") await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (state === "pending") throw new Error(`KIE request timed out: ${taskId}`);
  if (state === "failed") {
    const detail = task?.data?.errorMessage ?? task?.data?.errorCode ?? task?.msg ?? "failed";
    throw new Error(`KIE request failed: ${detail}`);
  }

  const mediaUrl = firstResultUrl(task);
  if (!mediaUrl) throw new Error(`KIE response returned no media URL for ${taskId}`);
  const media = await downloadProviderMedia(options.fetch, mediaUrl, kind);
  return {
    ...media,
    requestId: taskId,
    provider: "kie",
    modelEndpoint: route.upstreamModel,
  };
}

function replicatePredictionUrl(baseUrl: string, upstreamModel: string): string {
  const [owner, model] = upstreamModel.split("/", 2);
  if (!owner || !model) {
    throw new Error(`Replicate model must be owner/name, received ${upstreamModel}`);
  }
  return `${baseUrl}/models/${encodeURIComponent(owner)}/${encodeURIComponent(model)}/predictions`;
}

function replicateState(prediction: any): "pending" | "success" | "failed" {
  const state = String(prediction?.status ?? "").toLowerCase();
  if (state === "succeeded") return "success";
  if (state === "failed" || state === "canceled") return "failed";
  return "pending";
}

async function generateReplicateMedia(
  input: MockMediaGenerationInput,
  kind: ModelKind,
  route: ModelUpstreamRoute,
  options: Required<Pick<MockFalExternalAigcServiceOptions, "fetch">> &
    Pick<MockFalExternalAigcServiceOptions, "replicateBaseUrl">,
  apiKey: string,
): Promise<MockMediaGenerationResult> {
  const baseUrl = normalizeBaseUrl(options.replicateBaseUrl, "https://api.replicate.com/v1");
  const headers = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };
  const createResponse = await options.fetch(replicatePredictionUrl(baseUrl, route.upstreamModel), {
    method: "POST",
    headers,
    body: JSON.stringify({
      input: providerInput(input, kind),
    }),
  });
  let prediction = await responseJson(createResponse);
  if (!createResponse.ok) {
    throw new Error(`Replicate request failed: ${prediction?.detail ?? prediction?.error?.message ?? createResponse.statusText}`);
  }
  const predictionId = prediction?.id;
  if (typeof predictionId !== "string" || !predictionId) {
    throw new Error(`Replicate response returned no prediction id for ${route.upstreamModel}`);
  }

  let state = replicateState(prediction);
  const getUrl = typeof prediction?.urls?.get === "string"
    ? prediction.urls.get
    : `${baseUrl}/predictions/${encodeURIComponent(predictionId)}`;
  for (let attempt = 0; attempt < 240 && state === "pending"; attempt += 1) {
    const statusResponse = await options.fetch(getUrl, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    prediction = await responseJson(statusResponse);
    if (!statusResponse.ok) {
      throw new Error(`Replicate status failed: ${prediction?.detail ?? prediction?.error?.message ?? statusResponse.statusText}`);
    }
    state = replicateState(prediction);
    if (state === "pending") await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (state === "pending") throw new Error(`Replicate request timed out: ${predictionId}`);
  if (state === "failed") throw new Error(`Replicate request failed: ${prediction?.error ?? "failed"}`);

  const mediaUrl = firstResultUrl(prediction?.output ?? prediction);
  if (!mediaUrl) throw new Error(`Replicate response returned no media URL for ${predictionId}`);
  const media = await downloadProviderMedia(options.fetch, mediaUrl, kind);
  return {
    ...media,
    requestId: predictionId,
    provider: "replicate",
    modelEndpoint: route.upstreamModel,
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
  const loadProviderAccounts = options.providerAccounts;

  const providerIdForRoute = (route: ModelUpstreamRoute) => {
    if (route.providerId) return route.providerId;
    if (
      route.upstreamId === "openai" ||
      route.upstreamId === "google-ai-studio" ||
      route.upstreamId === "google-agent-platform" ||
      route.upstreamId === "anthropic"
    ) return "official";
    return route.upstreamId;
  };

  const accountForRoute = (
    route: ModelUpstreamRoute,
    accounts: RuntimeProviderAccountAvailability[] | undefined,
  ) => {
    const configuredModelPriority = (account: RuntimeProviderAccountAvailability) =>
      account.modelPriorities?.[route.modelCode] ?? Object.entries(account.modelPriorities ?? {})
        .find(([modelId]) => (normalizeModelId(modelId) ?? modelId.trim()) === route.modelCode)?.[1];
    const candidates = (accounts ?? [])
      .map((account, index) => ({ account, index }))
      .filter(({ account }) =>
        account.providerId === providerIdForRoute(route) &&
        (!account.upstreamId || account.upstreamId === route.upstreamId) &&
        (!account.region || !route.region || account.region === route.region) &&
        (!account.supportedModelIds?.length ||
          account.supportedModelIds
            .map((modelId) => normalizeModelId(modelId) ?? modelId.trim())
            .includes(route.modelCode))
      )
      .sort((a, b) => {
        const aModelPriority = configuredModelPriority(a.account);
        const bModelPriority = configuredModelPriority(b.account);
        if (aModelPriority !== undefined || bModelPriority !== undefined) {
          const priority = (aModelPriority ?? Number.POSITIVE_INFINITY) - (bModelPriority ?? Number.POSITIVE_INFINITY);
          if (priority !== 0) return priority;
        }
        const priority = (a.account.priority ?? 1000) - (b.account.priority ?? 1000);
        if (priority !== 0) return priority;
        const weight = (b.account.weight ?? 0) - (a.account.weight ?? 0);
        if (weight !== 0) return weight;
        return a.index - b.index;
      });

    const hasRequiredCredentials = (account: RuntimeProviderAccountAvailability) =>
      (route.requiredCredentials ?? []).every((key) => account.credentials?.[key]?.trim());
    const hasRequiredOAuth = (account: RuntimeProviderAccountAvailability) =>
      (route.requiredOAuth ?? []).every((provider) => account.availableOAuth?.includes(provider));
    return candidates.find(({ account }) =>
      account.enabled !== false &&
      hasRequiredCredentials(account) &&
      hasRequiredOAuth(account)
    )?.account ?? candidates.find(({ account }) => account.enabled !== false)?.account ?? candidates[0]?.account;
  };

  const credential = (
    route: ModelUpstreamRoute,
    accounts: RuntimeProviderAccountAvailability[] | undefined,
    key: string,
  ) => accountForRoute(route, accounts)?.credentials?.[key]?.trim();

  async function generateWithRoute(
    input: MockMediaGenerationInput,
    kind: ModelKind,
    fallback: () => Promise<MockMediaGenerationResult>,
  ): Promise<MockMediaGenerationResult> {
    const providerAccounts = loadProviderAccounts ? await loadProviderAccounts() : undefined;
    const route = resolveLocalRoute(input.model, kind, providerAccounts);
    if (!route || route.upstreamId === "mock") return fallback();

    if (route.apiShape === "openai-images") {
      const apiKey = credential(route, providerAccounts, "apiKey");
      if (!apiKey) return fallback();
      return generateOpenAiImage(input, route, {
        fetch: fetchImpl,
        openAiBaseUrl: options.openAiBaseUrl,
      }, apiKey);
    }

    if (route.apiShape === "openai-compatible") {
      const apiKey = credential(route, providerAccounts, "apiKey");
      if (!apiKey) return fallback();
      const model = stringParam(input.modelParams, "model_name") || route.upstreamModel;
      const result = await generateTextCompletion({
        provider: "openai-compatible",
        apiKey,
        baseUrl: credential(route, providerAccounts, "baseUrl") || options.openAiBaseUrl,
        model,
        systemPrompt: stringParam(input.modelParams, "system_prompt"),
        messages: [{ role: "user", content: input.prompt }],
        fetch: fetchImpl,
      });
      return {
        bytes: new TextEncoder().encode(result.text),
        contentType: "text/plain; charset=utf-8",
        requestId: input.taskId,
        provider: "openai-compatible",
        modelEndpoint: result.model,
      };
    }

    if (route.apiShape === "anthropic-compatible") {
      const apiKey = credential(route, providerAccounts, "apiKey");
      if (!apiKey) return fallback();
      const model = stringParam(input.modelParams, "model_name") || route.upstreamModel;
      const result = await generateTextCompletion({
        provider: "anthropic-compatible",
        apiKey,
        baseUrl: credential(route, providerAccounts, "baseUrl") || options.anthropicBaseUrl,
        model,
        systemPrompt: stringParam(input.modelParams, "system_prompt"),
        messages: [{ role: "user", content: input.prompt }],
        fetch: fetchImpl,
      });
      return {
        bytes: new TextEncoder().encode(result.text),
        contentType: "text/plain; charset=utf-8",
        requestId: input.taskId,
        provider: "anthropic-compatible",
        modelEndpoint: result.model,
      };
    }

    if (route.apiShape === "google-ai-studio") {
      const apiKey = credential(route, providerAccounts, "apiKey");
      if (!apiKey) return fallback();
      return generateGoogleAiStudioMedia(input, kind, route, {
        fetch: fetchImpl,
        googleAiStudioBaseUrl: options.googleAiStudioBaseUrl,
      }, apiKey);
    }

    if (route.apiShape === "google-agent-platform" && kind === "text") {
      const vertexCredentials = credential(route, providerAccounts, "vertexCredentials");
      if (!vertexCredentials) return fallback();
      return generateGoogleAgentPlatformText(input, route, fetchImpl, vertexCredentials);
    }

    if (route.apiShape === "fal") {
      const apiKey = credential(route, providerAccounts, "apiKey");
      if (!apiKey) return fallback();
      return generateFalMedia(input, kind, route, {
        fetch: fetchImpl,
        falQueueBaseUrl: options.falQueueBaseUrl,
      }, apiKey);
    }

    if (route.apiShape === "kie") {
      const apiKey = credential(route, providerAccounts, "apiKey");
      if (!apiKey) return fallback();
      return generateKieMedia(input, kind, route, {
        fetch: fetchImpl,
        kieBaseUrl: options.kieBaseUrl,
      }, apiKey);
    }

    if (route.apiShape === "replicate") {
      const apiKey = credential(route, providerAccounts, "apiKey");
      if (!apiKey) return fallback();
      return generateReplicateMedia(input, kind, route, {
        fetch: fetchImpl,
        replicateBaseUrl: options.replicateBaseUrl,
      }, apiKey);
    }

    if (route.apiShape === "dreamina-cli" && kind === "video") {
      const result = await generateDreaminaCliVideoMedia({
        prompt: input.prompt,
        modelName: input.model,
        upstreamModel: route.upstreamModel,
        duration: input.duration,
        aspectRatio: input.aspectRatio,
        run: options.dreaminaRun,
      });
      return {
        bytes: result.bytes,
        contentType: result.contentType,
        requestId: result.taskId,
        provider: "dreamina-cli",
        modelEndpoint: result.model,
      };
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

    async generateText(input) {
      const result = await generateWithRoute(input, "text", async () => ({
        bytes: new TextEncoder().encode(`Generated text (${input.model})\n\n${input.prompt || "Mock text"}`),
        contentType: "text/plain; charset=utf-8",
        requestId: input.taskId,
        provider: "mock",
        modelEndpoint: resolveMockFalModelId(input.model, "text", "mock-text"),
      }));
      return {
        text: new TextDecoder().decode(result.bytes),
        provider: result.provider,
        modelEndpoint: result.modelEndpoint,
      };
    },
  };
}
