import {
  normalizeModelId,
  applyModelProviderImplementation,
  MODEL_CARDS,
  modelRouteCredentialsSatisfied,
  resolveModelUpstreamRoute,
  validateModelCardConfiguration,
  coerceModelParameterInput,
  renderPositionalReferencePrompt,
  type ModelCard,
  type ModelKind,
  type ModelUpstreamRoute,
  type OrderedPromptContentPart,
  type ProviderAccountAvailability,
  type ProviderUsageAuditEvent,
  type ExecutablePluginBinding,
  type ExecutablePluginReference,
} from "@clash/shared-types";
import {
  buildMiniMaxH3Content,
  generateBflFlux3Video,
  resolveFlux3KeyframeIndices,
  generatePikaChat,
  createGeminiOmniInteraction,
  createPikaMediaJob,
  fetchPikaCatalogQuote,
  downloadGeminiOmniVideo,
  extractGeminiOmniVideo,
  geminiOmniInteractionId,
  geminiOmniInteractionStatus,
  generateTextCompletion,
  getPikaMediaContent,
  getGeminiOmniInteraction,
  uploadPikaMedia,
  pikaBillingBasis,
  waitForPikaMediaJob,
  type GeminiOmniInputPart,
  type TextContentPart,
} from "@clash/shared-runtime";

import {
  createMockFalQueueService,
  type FalAudioResult,
  type FalImageResult,
  type FalMockQueueService,
  type FalMockResult,
  type FalVideoResult,
} from "./fal-mock.js";
import { generateDreaminaCliVideoMedia, type DreaminaCliRun } from "./dreamina-cli.js";
import {
  createProviderConformanceStubs,
  createProviderTestRecordingFetch,
  createProviderTestReplayFetch,
  filterProviderTestReplayFixturesForStub,
  type ProviderTestRecorder,
  type ProviderTestReplayFixture,
} from "./provider-test-recorder.js";

const LOCAL_EXECUTABLE_MODEL_API_SHAPES = new Set([
  "anthropic-compatible",
  "bfl",
  "dreamina-cli",
  "fal",
  "google-agent-platform",
  "google-ai-studio",
  "google-ai-studio-interactions",
  "kie",
  "local-asr",
  "local-tts",
  "minimax",
  "openai-compatible",
  "openai-images",
  "pika",
  "pika-chat",
  "replicate",
  "suno",
]);

export function localExecutableModelCards(models: readonly ModelCard[]): ModelCard[] {
  return models.map((model) => ({
    ...model,
    providerImplementations: (model.providerImplementations ?? [])
      .filter((implementation) =>
        LOCAL_EXECUTABLE_MODEL_API_SHAPES.has(implementation.apiShape)
        || !!implementation.executorExportId),
  }));
}

export interface MockMediaGenerationInput {
  /** Set when asking about work already accepted; forwarded to the plugin untouched. */
  pollState?: unknown;
  taskId: string;
  projectId?: string;
  nodeId?: string;
  actorType?: "user" | "agent";
  actorUserId?: string;
  actorAgentId?: string;
  prompt: string;
  model: string;
  aspectRatio?: string;
  /**
   * Seconds, or a sentinel the Card offers.
   *
   * Several models let the provider choose the length, and they spell that `auto` on the
   * menu next to the numbers. Typing this as `number` forced a number to be invented for
   * them, and a model whose menu omitted it -- `seedance-2-fast-startend` offers
   * [auto, 4, 6, 8, 10, 15] -- failed validation on a value no one had asked for.
   */
  duration?: number | string;
  modelParams?: Record<string, unknown>;
  startFrameUrl?: string;
  endFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  orderedContentParts?: OrderedPromptContentPart[];
  referenceAudio?: {
    bytes: Uint8Array;
    contentType: string;
  };
  /** Exact plugin contract selected when the node was authored. */
  pluginBinding?: ExecutablePluginBinding;
}

function promptForRoute(input: MockMediaGenerationInput, route: ModelUpstreamRoute): string {
  const binding = route.referenceBinding;
  if (binding?.type !== "positional-tokens" || !input.orderedContentParts?.some((part) => part.type !== "text")) {
    return input.prompt;
  }
  return renderPositionalReferencePrompt({
    parts: input.orderedContentParts,
    references: {
      image: input.referenceImageUrls ?? [],
      video: input.referenceVideoUrls ?? [],
      audio: input.referenceAudioUrls ?? [],
    },
    tokens: binding.tokens ?? {},
  });
}

/**
 * Spell a reference's media type the way upstreams that derive a filename accept.
 *
 * MiniMax reads the mime out of a data URL and turns it into an extension, then checks
 * that extension against its own allow-list. `audio/mpeg` becomes `.mpeg`, which is not
 * on it, so an MP3 our own TTS had just produced was rejected with
 * `audio format ".mpeg" not allowed` -- after the video task had been submitted and
 * queued. The card already knows the answer: MINIMAX_H3_AUDIO_CONSTRAINTS lists
 * `fileExtensions: ['wav', 'mp3']` next to a mimeTypes list that includes `audio/mpeg`.
 */
const REFERENCE_MIME_ALIASES: Readonly<Record<string, string>> = {
  // Same bytes, and the spelling whose derived extension is allowed.
  "audio/mpeg": "audio/mp3",
  "audio/x-wav": "audio/wav",
  "image/jpg": "image/jpeg",
};

/**
 * The duration in seconds, or undefined when the Card left the choice to the provider.
 *
 * A Card may offer `auto` alongside the numbers, and some providers take only a number.
 * Dropping the sentinel is the right translation for those: omitting the field is exactly
 * how their API expresses "you decide".
 */
function durationSecondsOrUndefined(duration: number | string | undefined): number | undefined {
  if (typeof duration === "number") return duration;
  if (typeof duration === "string") {
    const parsed = Number(duration);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function referenceDataUrlMimeType(contentType: string): string {
  return REFERENCE_MIME_ALIASES[contentType] ?? contentType;
}

async function loadReferenceData(fetchImpl: typeof fetch, mediaUrl: string): Promise<{ data: Uint8Array; mediaType: string }> {
  const dataUri = /^data:([^;,]+);base64,(.*)$/s.exec(mediaUrl);
  if (dataUri) {
    return { data: new Uint8Array(Buffer.from(dataUri[2] ?? "", "base64")), mediaType: dataUri[1] ?? "application/octet-stream" };
  }
  const response = await fetchImpl(mediaUrl);
  if (!response.ok) throw new Error(`Multimodal reference read failed: ${response.status}`);
  return {
    data: new Uint8Array(await response.arrayBuffer()),
    mediaType: (response.headers.get("content-type") || "application/octet-stream").split(";", 1)[0],
  };
}

async function orderedTextCompletionContent(
  input: MockMediaGenerationInput,
  fetchImpl: typeof fetch,
): Promise<string | TextContentPart[]> {
  if (!input.orderedContentParts?.length) return input.prompt;
  const content: TextContentPart[] = [];
  for (const part of input.orderedContentParts) {
    if (part.type === "text") {
      content.push(part);
      continue;
    }
    if (part.type !== "image") {
      throw new Error(`The selected text provider does not support inline ${part.type} references.`);
    }
    const reference = await loadReferenceData(fetchImpl, part.url);
    content.push({ type: "image", ...reference });
  }
  return content;
}

/**
 * A generation that has not finished yet.
 *
 * The provider holds the work and the host holds the way back to it. Kept beside the completed
 * shape rather than signalled by an exception, because a caller that catches an acceptance treats
 * it as a failure -- and a failure is retried, which buys the same generation twice.
 */
export interface MediaGenerationAccepted {
  status: "accepted";
  /** Opaque to the host; persisted on the node and returned to the plugin on the next poll. */
  pollState: unknown;
  retryAfterMs?: number;
  provider?: string;
  modelEndpoint?: string;
  pluginBinding?: ExecutablePluginBinding;
}

export interface MockMediaGenerationCompleted {
  status?: "completed";
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
  pluginBinding?: ExecutablePluginBinding;
}

export type MockMediaGenerationResult = MockMediaGenerationCompleted | MediaGenerationAccepted;

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
  modelCards?: () => Promise<ModelCard[]>;
  fetch?: typeof fetch;
  openAiBaseUrl?: string;
  anthropicBaseUrl?: string;
  falQueueBaseUrl?: string;
  googleAiStudioBaseUrl?: string;
  googleAiStudioApiKey?: string;
  googleAiStudioGatewayToken?: string;
  providerTraffic?:
    | {
        mode: "record";
        recorder: () => Promise<ProviderTestRecorder>;
      }
    | {
        mode: "replay";
        fixtures: () => Promise<readonly ProviderTestReplayFixture[]>;
      };
  kieBaseUrl?: string;
  sunoBaseUrl?: string;
  minimaxBaseUrl?: string;
  pikaBaseUrl?: string;
  providerUsageAudit?: (event: ProviderUsageAuditEvent) => Promise<void>;
  replicateBaseUrl?: string;
  bflBaseUrl?: string;
  dreaminaRun?: DreaminaCliRun;
  localTts?: (input: MockMediaGenerationInput) => Promise<MockMediaGenerationResult>;
  /** Kernel-owned adapter for the Bridge executable-plugin host. */
  providerPluginProjector?: ProviderPluginProjector;
  /** Kernel-owned adapter for a plugin-defined provider's full lifecycle. */
  providerPluginExecutor?: ProviderPluginExecutor;
}

export interface ProviderPluginProjectorRequest {
  pluginId: string;
  exportId: string;
  kind: ModelKind;
  taskId: string;
  projectId: string;
  nodeId?: string;
  binding?: ExecutablePluginBinding;
  input: {
    values: Record<string, unknown>;
    references: ExecutablePluginReference[];
  };
}

export interface ProviderPluginProjection {
  endpoint: string;
  input: Record<string, unknown>;
}

export interface ProviderPluginProjectorResponse {
  binding: ExecutablePluginBinding;
  projection: ProviderPluginProjection;
}

export type ProviderPluginProjector = (
  request: ProviderPluginProjectorRequest,
) => Promise<ProviderPluginProjectorResponse>;

export interface ProviderPluginExecutorRequest {
  pluginId: string;
  exportId: string;
  kind: ModelKind;
  taskId: string;
  projectId: string;
  nodeId?: string;
  binding?: ExecutablePluginBinding;
  input: {
    values: Record<string, unknown>;
    references: ExecutablePluginReference[];
  };
  /**
   * Set when asking about work already accepted, carrying exactly what the plugin returned.
   *
   * Opaque on purpose: an id, a status URL, a job name with its region, or anything else a provider
   * needs. The host persists it and hands it back without reading it, so a provider that has no
   * task id is not forced to invent one.
   */
  pollState?: unknown;
}

export interface ProviderPluginExecutorMedia {
  url: string;
  contentType?: string;
  requestId?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  waveform?: number[];
  transcript?: string;
}

/**
 * Either the provider finished, or it took the work and told us how to ask again.
 *
 * Typed as a union rather than as media-with-exceptions, because an acceptance thrown as an error
 * cannot be told apart from a failure by the code that catches it -- and the difference is that one
 * of them has already been paid for.
 */
export type ProviderPluginExecutorResponse =
  | {
      status: "completed";
      binding: ExecutablePluginBinding;
      media: ProviderPluginExecutorMedia;
    }
  | {
      status: "accepted";
      binding: ExecutablePluginBinding;
      /** Opaque; stored on the node and handed back verbatim on the next poll. */
      pollState: unknown;
      retryAfterMs?: number;
    };

export type ProviderPluginExecutor = (
  request: ProviderPluginExecutorRequest,
) => Promise<ProviderPluginExecutorResponse>;

/** Only transport/host absence may use the temporary built-in compatibility projector. */
export class ProviderPluginHostUnavailableError extends Error {
  override name = "ProviderPluginHostUnavailableError";
}

type RuntimeProviderAccountAvailability = ProviderAccountAvailability & {
  credentials?: Record<string, string>;
};

function cloudflareGoogleEnvironmentAccount(
  options: Pick<
    MockFalExternalAigcServiceOptions,
    "googleAiStudioApiKey" | "googleAiStudioBaseUrl" | "googleAiStudioGatewayToken"
  >,
): RuntimeProviderAccountAvailability | undefined {
  const baseUrl = options.googleAiStudioBaseUrl?.trim();
  const gatewayToken = options.googleAiStudioGatewayToken?.trim();
  let isCloudflareGateway = false;
  try {
    isCloudflareGateway = !!baseUrl && new URL(baseUrl).hostname === "gateway.ai.cloudflare.com";
  } catch {
    isCloudflareGateway = false;
  }
  const apiKey = options.googleAiStudioApiKey?.trim();
  if (apiKey && gatewayToken) {
    throw new Error(
      "Choose either Google API key or Cloudflare AI Gateway token for Gemini Omni.",
    );
  }
  if (!apiKey && !gatewayToken) return undefined;
  if (gatewayToken && !isCloudflareGateway) {
    throw new Error(
      "Cloudflare AI Gateway token requires a Cloudflare Google AI Studio Gateway base URL.",
    );
  }
  const configuredCredentials = [
    ...(apiKey ? ["apiKey"] : []),
    ...(gatewayToken ? ["gatewayToken"] : []),
    ...(baseUrl ? ["baseUrl"] : []),
  ];
  return {
    id: "google-ai-studio-environment",
    providerId: "official",
    upstreamId: "google-ai-studio",
    region: "global",
    enabled: true,
    priority: 10_000,
    configuredCredentials,
    credentials: {
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(gatewayToken ? { gatewayToken } : {}),
    },
  };
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

function resolveLocalRoute(
  model: string,
  kind: ModelKind,
  providerAccounts?: RuntimeProviderAccountAvailability[],
  preferredProviderId?: string,
  models?: ModelCard[],
): ModelUpstreamRoute | null {
  if (providerAccounts) {
    const eligibleProviderAccounts = preferredProviderId
      ? providerAccounts.filter((account) => account.providerId === preferredProviderId)
      : providerAccounts;
    return resolveModelUpstreamRoute({
      modelCode: model,
      kind,
      allowMock: eligibleProviderAccounts.some(
        (account) => account.providerId === "mock" && account.enabled !== false,
      ),
      configuredProviders: eligibleProviderAccounts,
      ...(models ? { models } : {}),
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

function hexToBytes(data: string): Uint8Array {
  const clean = data.trim();
  if (!clean || clean.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(clean)) {
    throw new Error("MiniMax response returned invalid hex media.");
  }
  return new Uint8Array(Buffer.from(clean, "hex"));
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
): Promise<MockMediaGenerationCompleted> {
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
  const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
  if (input.referenceAudio) {
    parts.push({
      inlineData: {
        mimeType: input.referenceAudio.contentType,
        data: Buffer.from(input.referenceAudio.bytes).toString("base64"),
      },
    });
  }
  const body: Record<string, unknown> = {
    contents: [{ parts }],
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
): Promise<MockMediaGenerationCompleted> {
  if (kind !== "image" && kind !== "audio" && kind !== "text") throw missingAdapter(route);
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
  if (kind === "text") {
    const text = googleText(json);
    if (!text) {
      throw new Error(`Google AI Studio response returned no text for ${route.upstreamModel}`);
    }
    return {
      bytes: new TextEncoder().encode(text),
      contentType: "text/plain; charset=utf-8",
      requestId: input.taskId,
      provider: "google",
      modelEndpoint: route.upstreamModel,
    };
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

async function geminiOmniInput(
  input: MockMediaGenerationInput,
  fetchImpl: typeof fetch,
): Promise<GeminiOmniInputPart[]> {
  const result: GeminiOmniInputPart[] = [];
  const mentionedUrls = new Set<string>();
  for (const part of input.orderedContentParts ?? []) {
    if (part.type === "text") {
      if (part.text) result.push(part);
      continue;
    }
    if (part.type !== "image") {
      throw new Error(`Gemini Omni currently accepts inline image references, not ${part.type}.`);
    }
    const reference = await loadReferenceData(fetchImpl, part.url);
    result.push({
      type: "image",
      data: Buffer.from(reference.data).toString("base64"),
      mimeType: reference.mediaType,
    });
    mentionedUrls.add(part.url);
  }
  if (!result.some((part) => part.type === "text") && input.prompt) {
    result.unshift({ type: "text", text: input.prompt });
  }
  for (const url of input.referenceImageUrls ?? []) {
    if (mentionedUrls.has(url)) continue;
    const reference = await loadReferenceData(fetchImpl, url);
    result.push({
      type: "image",
      data: Buffer.from(reference.data).toString("base64"),
      mimeType: reference.mediaType,
    });
  }
  if (!result.length) throw new Error("Gemini Omni requires a prompt or at least one reference image.");
  return result;
}

async function generateGeminiOmniVideo(
  input: MockMediaGenerationInput,
  route: ModelUpstreamRoute,
  options: Required<Pick<MockFalExternalAigcServiceOptions, "fetch">> &
    Pick<MockFalExternalAigcServiceOptions, "googleAiStudioBaseUrl"> & {
      providerFetch?: typeof fetch;
    },
  auth: { apiKey?: string; gatewayToken?: string },
): Promise<MockMediaGenerationCompleted> {
  const baseUrl = normalizeBaseUrl(options.googleAiStudioBaseUrl, "https://generativelanguage.googleapis.com/v1beta");
  const providerFetch = options.providerFetch ?? options.fetch;
  let interaction = await createGeminiOmniInteraction({
    apiKey: auth.apiKey,
    gatewayToken: auth.gatewayToken,
    baseUrl,
    model: route.upstreamModel,
    input: await geminiOmniInput(input, options.fetch),
    aspectRatio: input.aspectRatio === "9:16" ? "9:16" : "16:9",
    duration: durationSecondsOrUndefined(input.duration) ?? numberParam(input.modelParams, "duration", 5),
    fetch: providerFetch,
  });
  const interactionId = geminiOmniInteractionId(interaction);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = geminiOmniInteractionStatus(interaction);
    if (["completed", "succeeded", "success"].includes(status)) break;
    if (["failed", "cancelled", "canceled", "error", "incomplete"].includes(status)) {
      throw new Error(`Gemini Omni interaction ${status}: ${interaction.error?.message ?? "unknown failure"}`);
    }
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 5_000));
    interaction = await getGeminiOmniInteraction({
      apiKey: auth.apiKey,
      gatewayToken: auth.gatewayToken,
      baseUrl,
      interactionId,
      fetch: providerFetch,
    });
  }
  if (!["completed", "succeeded", "success"].includes(geminiOmniInteractionStatus(interaction))) {
    throw new Error("Gemini Omni interaction timed out after 10 minutes.");
  }
  const output = extractGeminiOmniVideo(interaction);
  if (!output) throw new Error("Gemini Omni completed without a video output.");
  const media = output.data
    ? { bytes: base64ToBytes(output.data), mimeType: output.mimeType }
    : output.uri
      ? await downloadGeminiOmniVideo({
          apiKey: auth.apiKey,
          gatewayToken: auth.gatewayToken,
          baseUrl,
          uri: output.uri,
          fetch: providerFetch,
        })
      : null;
  if (!media) throw new Error("Gemini Omni video output did not include data or a URI.");
  return {
    bytes: new Uint8Array(media.bytes),
    contentType: media.mimeType,
    requestId: interactionId,
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

function googleAgentPlatformModelUrl(
  credentials: GoogleAgentPlatformCredentials,
  location: string,
  route: ModelUpstreamRoute,
  action: string,
): string {
  return `https://${vertexBaseHost(location)}/v1/projects/${credentials.project}/locations/${location}/publishers/google/models/${route.upstreamModel}:${action}`;
}

async function googleAgentPlatformTextBody(input: MockMediaGenerationInput, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  if (input.orderedContentParts?.length) {
    for (const part of input.orderedContentParts) {
      if (part.type === "text") {
        parts.push({ text: part.text });
        continue;
      }
      const reference = await loadReferenceData(fetchImpl, part.url);
      parts.push({
        inlineData: {
          mimeType: reference.mediaType,
          data: Buffer.from(reference.data).toString("base64"),
        },
      });
    }
  } else {
    parts.push({ text: input.prompt });
  }
  if (input.referenceAudio) {
    parts.push({
      inlineData: {
        mimeType: input.referenceAudio.contentType,
        data: Buffer.from(input.referenceAudio.bytes).toString("base64"),
      },
    });
  }
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts }],
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

function googleAgentPlatformImageBody(input: MockMediaGenerationInput): Record<string, unknown> {
  const params = input.modelParams ?? {};
  const imageConfig: Record<string, unknown> = {};
  const aspectRatio = input.aspectRatio || stringParam(params, "aspect_ratio");
  if (aspectRatio) imageConfig.aspectRatio = aspectRatio;
  const resolution = stringParam(params, "resolution");
  if (resolution) imageConfig.imageSize = resolution.toLowerCase();
  return {
    contents: [{ role: "user", parts: [{ text: input.prompt }] }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
    },
  };
}

function googleAgentPlatformVideoBody(input: MockMediaGenerationInput): Record<string, unknown> {
  const params = input.modelParams ?? {};
  const parameters: Record<string, unknown> = {
    aspectRatio: input.aspectRatio || stringParam(params, "aspect_ratio") || "16:9",
    sampleCount: Math.max(1, Math.min(4, numberParam(params, "count", 1))),
    personGeneration: stringParam(params, "person_generation") || "allow_adult",
  };
  const durationSeconds = durationSecondsOrUndefined(input.duration) ?? numberParam(params, "duration", 0);
  if (durationSeconds > 0) parameters.durationSeconds = durationSeconds;
  const negativePrompt = stringParam(params, "negative_prompt") || stringParam(params, "negativePrompt");
  if (negativePrompt) parameters.negativePrompt = negativePrompt;
  const resolution = stringParam(params, "resolution");
  if (resolution) parameters.resolution = resolution;
  const seed = numberParam(params, "seed", Number.NaN);
  if (Number.isFinite(seed)) parameters.seed = seed;
  return {
    instances: [{ prompt: input.prompt }],
    parameters,
  };
}

function googleVideoInlineData(json: any): { data: string; mimeType: string } | null {
  const response = json?.response ?? json;
  const samples = response?.generated_samples ?? response?.generatedVideos ?? response?.videos ?? [];
  if (!Array.isArray(samples)) return null;
  for (const sample of samples) {
    const video = sample?.video ?? sample;
    const data = video?.bytesBase64Encoded ?? video?.data;
    if (typeof data === "string" && data) {
      return {
        data,
        mimeType: video?.mimeType ?? video?.mime_type ?? "video/mp4",
      };
    }
  }
  return null;
}

function googleVideoUri(json: any): string | null {
  const response = json?.response ?? json;
  const samples = response?.generated_samples ?? response?.generatedVideos ?? response?.videos ?? [];
  if (!Array.isArray(samples)) return null;
  for (const sample of samples) {
    const video = sample?.video ?? sample;
    const uri = video?.uri ?? video?.gcsUri ?? video?.gcs_uri;
    if (typeof uri === "string" && uri) return uri;
  }
  return null;
}

async function generateGoogleAgentPlatformText(
  input: MockMediaGenerationInput,
  route: ModelUpstreamRoute,
  fetchImpl: typeof fetch,
  rawCredentials: string,
): Promise<MockMediaGenerationCompleted> {
  const credentials = parseGoogleAgentPlatformCredentials(rawCredentials);
  const location = credentials.location || route.region || "global";
  const token = await googleVertexAccessToken(credentials, fetchImpl);
  const response = await fetchImpl(googleAgentPlatformModelUrl(credentials, location, route, "generateContent"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(await googleAgentPlatformTextBody(input, fetchImpl)),
  });
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

async function generateGoogleAgentPlatformImage(
  input: MockMediaGenerationInput,
  route: ModelUpstreamRoute,
  fetchImpl: typeof fetch,
  rawCredentials: string,
): Promise<MockMediaGenerationCompleted> {
  const credentials = parseGoogleAgentPlatformCredentials(rawCredentials);
  const location = credentials.location || route.region || "global";
  const token = await googleVertexAccessToken(credentials, fetchImpl);
  const response = await fetchImpl(googleAgentPlatformModelUrl(credentials, location, route, "generateContent"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(googleAgentPlatformImageBody(input)),
  });
  const json = await responseJson(response);
  if (!response.ok) {
    throw new Error(`Google Cloud Agent Platform image request failed: ${json?.error?.message ?? response.statusText}`);
  }
  const inlineData = googleInlineData(json);
  if (!inlineData) {
    throw new Error(`Google Cloud Agent Platform response returned no image for ${route.upstreamModel}.`);
  }
  return {
    bytes: base64ToBytes(inlineData.data),
    contentType: inlineData.mimeType,
    requestId: input.taskId,
    provider: "google-agent-platform",
    modelEndpoint: route.upstreamModel,
  };
}

async function generateGoogleAgentPlatformVideo(
  input: MockMediaGenerationInput,
  route: ModelUpstreamRoute,
  fetchImpl: typeof fetch,
  rawCredentials: string,
): Promise<MockMediaGenerationCompleted> {
  const credentials = parseGoogleAgentPlatformCredentials(rawCredentials);
  const location = credentials.location || route.region || "global";
  const token = await googleVertexAccessToken(credentials, fetchImpl);
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const submitResponse = await fetchImpl(googleAgentPlatformModelUrl(credentials, location, route, "predictLongRunning"), {
    method: "POST",
    headers,
    body: JSON.stringify(googleAgentPlatformVideoBody(input)),
  });
  const submitted = await responseJson(submitResponse);
  if (!submitResponse.ok) {
    throw new Error(`Google Cloud Agent Platform video request failed: ${submitted?.error?.message ?? submitResponse.statusText}`);
  }
  const operationName = submitted?.name;
  if (typeof operationName !== "string" || !operationName) {
    throw new Error(`Google Cloud Agent Platform video response returned no operation name for ${route.upstreamModel}.`);
  }

  let operation: any = null;
  for (let attempt = 0; attempt < 108; attempt += 1) {
    const pollResponse = await fetchImpl(googleAgentPlatformModelUrl(credentials, location, route, "fetchPredictOperation"), {
      method: "POST",
      headers,
      body: JSON.stringify({ operationName }),
    });
    operation = await responseJson(pollResponse);
    if (!pollResponse.ok) {
      throw new Error(`Google Cloud Agent Platform video poll failed: ${operation?.error?.message ?? pollResponse.statusText}`);
    }
    if (operation?.done) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (!operation?.done) {
    throw new Error(`Google Cloud Agent Platform video request timed out: ${operationName}`);
  }
  if (operation.error) {
    throw new Error(`Google Cloud Agent Platform video request failed: ${JSON.stringify(operation.error).slice(0, 500)}`);
  }
  const inlineData = googleVideoInlineData(operation);
  if (!inlineData) {
    const uri = googleVideoUri(operation);
    if (uri) {
      throw new Error(`Google Cloud Agent Platform video returned a URI instead of inline bytes: ${uri}`);
    }
    throw new Error(`Google Cloud Agent Platform video response returned no video for ${route.upstreamModel}.`);
  }
  return {
    bytes: base64ToBytes(inlineData.data),
    contentType: inlineData.mimeType,
    requestId: operationName,
    provider: "google-agent-platform",
    modelEndpoint: route.upstreamModel,
  };
}

function falInput(
  input: MockMediaGenerationInput,
  kind: ModelKind,
  route: ModelUpstreamRoute,
): Record<string, unknown> {
  if (kind === "image") {
    const params = input.modelParams ?? {};
    if (route.upstreamModel === "openai/gpt-image-2" || route.upstreamModel === "openai/gpt-image-2/edit") {
      const width = numberParam(params, "width", 0);
      const height = numberParam(params, "height", 0);
      const explicitSize = width > 0 && height > 0
        ? { width, height }
        : undefined;
      if (explicitSize && (width % 16 !== 0 || height % 16 !== 0)) {
        throw new RangeError("fal GPT Image 2 width and height must be multiples of 16");
      }
      return {
        prompt: input.prompt,
        image_size: explicitSize
          ?? stringParam(params, "image_size")
          ?? aspectRatioToFalImageSize(input.aspectRatio),
        quality: stringParam(params, "quality") || "high",
        num_images: Math.max(1, Math.min(4, numberParam(params, "count", 1))),
        output_format: outputFormat(params),
        ...(input.referenceImageUrls?.length ? { image_urls: input.referenceImageUrls } : {}),
      };
    }
    if (route.upstreamModel.startsWith("fal-ai/bytedance/seedream/v4.5/")) {
      return {
        prompt: input.prompt,
        image_size: stringParam(params, "image_size") || "auto_2K",
        num_images: Math.max(1, Math.min(4, numberParam(params, "count", 1))),
        max_images: Math.max(1, Math.min(4, numberParam(params, "max_images", 1))),
        enable_safety_checker: params.enable_safety_checker !== false,
        ...(input.referenceImageUrls?.length ? { image_urls: input.referenceImageUrls } : {}),
      };
    }
    return {
      prompt: input.prompt,
      aspect_ratio: input.aspectRatio || stringParam(params, "aspect_ratio") || "16:9",
      image_size: stringParam(params, "image_size") || aspectRatioToFalImageSize(input.aspectRatio),
      output_format: stringParam(params, "output_format") || "png",
      num_images: Math.max(1, Math.min(4, numberParam(params, "count", 1))),
      ...(params.resolution ? { resolution: params.resolution } : {}),
      ...(params.num_inference_steps ? { num_inference_steps: params.num_inference_steps } : {}),
      ...(params.guidance_scale ? { guidance_scale: params.guidance_scale } : {}),
      ...(input.referenceImageUrls?.length ? { image_urls: input.referenceImageUrls } : {}),
    };
  }
  if (kind === "video") {
    const params = input.modelParams ?? {};
    if (route.modelCode.startsWith("flux-3-video")) {
      const common = {
        prompt: promptForRoute(input, route),
        duration: input.duration ?? params.duration ?? "auto",
        aspect_ratio: input.aspectRatio || stringParam(params, "aspect_ratio") || "auto",
        resolution: stringParam(params, "resolution") || "720p",
        generate_audio: params.generate_audio ?? true,
        safety_tolerance: params.safety_tolerance ?? 2,
      };
      if (route.modelCode === "flux-3-video-continue") {
        const videoUrl = input.referenceVideoUrls?.[0];
        if (!videoUrl) throw new Error("FLUX 3 continuation requires one source video.");
        return { ...common, video_url: videoUrl };
      }
      if (route.modelCode === "flux-3-video-keyframes") {
        const images = input.referenceImageUrls ?? [];
        if (images.length === 0) throw new Error("FLUX 3 keyframe generation requires at least one image.");
        if (images.length === 1) return { ...common, image_url: images[0] };
        if (images.length === 2) return { ...common, start_image_url: images[0], end_image_url: images[1] };
        const duration = typeof common.duration === "number"
          ? common.duration
          : Number.parseInt(String(common.duration), 10);
        if (!Number.isFinite(duration)) {
          throw new Error("FLUX 3 multi-keyframe generation requires an explicit duration.");
        }
        const frameIndices = resolveFlux3KeyframeIndices(params, images.length, duration);
        return {
          ...common,
          keyframes: images.map((imageUrl, index) => ({
            image_url: imageUrl,
            frame_index: frameIndices[index],
          })),
        };
      }
      return common;
    }
    if (route.modelCode === "minimax-h3-startend") {
      if (!input.startFrameUrl) {
        throw new Error("MiniMax H3 start/end generation requires a start frame");
      }
      return {
        prompt: promptForRoute(input, route),
        duration: input.duration ?? params.duration ?? 5,
        resolution: stringParam(params, "resolution") || "768P",
        image_url: input.startFrameUrl,
        ...(input.endFrameUrl ? { end_image_url: input.endFrameUrl } : {}),
      };
    }
    if (route.modelCode === "minimax-h3") {
      const hasReferences = !!(
        input.referenceImageUrls?.length
        || input.referenceVideoUrls?.length
        || input.referenceAudioUrls?.length
      );
      if (!hasReferences && input.aspectRatio === "adaptive") {
        throw new Error("MiniMax H3 Auto aspect ratio on fal requires at least one reference");
      }
      return {
        prompt: promptForRoute(input, route),
        aspect_ratio: input.aspectRatio || stringParam(params, "aspect_ratio") || "16:9",
        duration: input.duration ?? params.duration ?? 5,
        resolution: stringParam(params, "resolution") || "768P",
        ...(input.referenceImageUrls?.length ? { reference_image_urls: input.referenceImageUrls } : {}),
        ...(input.referenceVideoUrls?.length ? { reference_video_urls: input.referenceVideoUrls } : {}),
        ...(input.referenceAudioUrls?.length ? { reference_audio_urls: input.referenceAudioUrls } : {}),
      };
    }
    if (route.modelCode === "kling-3") {
      if (!input.startFrameUrl) {
        throw new Error("Kling 3 generation requires a start frame");
      }
      return {
        prompt: promptForRoute(input, route),
        duration: String(input.duration ?? params.duration ?? "5"),
        generate_audio: params.generate_audio ?? true,
        start_image_url: input.startFrameUrl,
        ...(input.endFrameUrl ? { end_image_url: input.endFrameUrl } : {}),
      };
    }
    return {
      prompt: promptForRoute(input, route),
      aspect_ratio: input.aspectRatio || stringParam(params, "aspect_ratio") || "16:9",
      duration: input.duration ?? params.duration ?? 4,
      ...(params.resolution ? { resolution: params.resolution } : {}),
      ...(params.generate_audio !== undefined ? { generate_audio: params.generate_audio } : {}),
      ...(input.referenceImageUrls?.length ? { image_urls: input.referenceImageUrls } : {}),
      ...(input.referenceVideoUrls?.length ? { video_urls: input.referenceVideoUrls } : {}),
      ...(input.referenceAudioUrls?.length ? { audio_urls: input.referenceAudioUrls } : {}),
    };
  }
  if (kind === "audio" && route.modelCode === "minimax-music-3") {
    const params = input.modelParams ?? {};
    return {
      prompt: input.prompt,
      lyrics: stringParam(params, "lyrics") ?? "",
      lyrics_optimizer: params.lyrics_optimizer === true,
      is_instrumental: params.is_instrumental === true,
      audio_setting: {
        sample_rate: numberParam(params, "sample_rate", 44100),
        bitrate: numberParam(params, "bitrate", 256000),
        format: stringParam(params, "format") || "mp3",
      },
    };
  }
  return {
    prompt: input.prompt,
    duration: input.duration ?? 5,
  };
}

const FAL_IMAGE_EDIT_ENDPOINTS: Record<string, string> = {
  "openai/gpt-image-2": "openai/gpt-image-2/edit",
  "fal-ai/nano-banana-2": "fal-ai/nano-banana-2/edit",
  "fal-ai/flux-2-pro": "fal-ai/flux-2-pro/edit",
  "fal-ai/bytedance/seedream/v4.5/text-to-image": "fal-ai/bytedance/seedream/v4.5/edit",
};

function falEndpoint(input: MockMediaGenerationInput, kind: ModelKind, route: ModelUpstreamRoute): string {
  if (kind === "video" && route.modelCode === "flux-3-video-keyframes") {
    const imageCount = input.referenceImageUrls?.length ?? 0;
    if (imageCount === 1) return "blackforestlabs/flux-3/image-to-video";
    if (imageCount === 2) return "blackforestlabs/flux-3/first-last-frame-to-video";
    return "blackforestlabs/flux-3/keyframes-to-video";
  }
  if (kind === "video" && route.modelCode === "minimax-h3") {
    const hasReferences = !!(
      input.referenceImageUrls?.length
      || input.referenceVideoUrls?.length
      || input.referenceAudioUrls?.length
    );
    return hasReferences
      ? "minimax/h3/reference-to-video"
      : "minimax/h3/text-to-video";
  }
  if (kind === "video" && route.modelCode === "minimax-h3-startend") {
    return "minimax/h3/image-to-video";
  }
  if (kind === "video" && route.modelCode === "seedance-2-ref") {
    const hasReferences = !!(
      input.referenceImageUrls?.length
      || input.referenceVideoUrls?.length
      || input.referenceAudioUrls?.length
    );
    return hasReferences
      ? "bytedance/seedance-2.0/reference-to-video"
      : "bytedance/seedance-2.0/text-to-video";
  }
  if (kind !== "image" || !input.referenceImageUrls?.length) return route.upstreamModel;
  const editEndpoint = FAL_IMAGE_EDIT_ENDPOINTS[route.upstreamModel];
  if (!editEndpoint) {
    throw new Error(`fal image model does not support editing: ${route.upstreamModel}`);
  }
  return editEndpoint;
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

function providerPluginProjectionRequest(
  input: MockMediaGenerationInput,
  kind: ModelKind,
  route: ModelUpstreamRoute,
): {
  request: ProviderPluginProjectorRequest;
  assetUrls: Map<string, string>;
} {
  if (!route.projectorPluginId || !route.projectorExportId) {
    throw new Error(`Route ${route.modelCode} has no executable provider projector.`);
  }
  if (input.pluginBinding && (
    input.pluginBinding.pluginId !== route.projectorPluginId
    || input.pluginBinding.exportId !== route.projectorExportId
  )) {
    throw new Error(
      `Pinned plugin ${input.pluginBinding.pluginId}/${input.pluginBinding.exportId} does not match `
        + `route projector ${route.projectorPluginId}/${route.projectorExportId}.`,
    );
  }

  const references: ExecutablePluginReference[] = [];
  const assetUrls = new Map<string, string>();
  const addReference = (
    slot: string,
    index: number,
    kind: "image" | "video" | "audio",
    url: string | undefined,
  ) => {
    if (!url) return;
    const uri = `clash-asset://provider-projector/${encodeURIComponent(input.taskId)}/${slot}/${index}`;
    assetUrls.set(uri, url);
    references.push({
      slot,
      index,
      asset: {
        assetId: `${input.taskId}:${slot}:${index}`,
        uri,
        kind,
      },
    });
  };
  addReference("startFrame", 0, "image", input.startFrameUrl);
  addReference("endFrame", 0, "image", input.endFrameUrl);
  input.referenceImageUrls?.forEach((url, index) => addReference("image", index, "image", url));
  input.referenceVideoUrls?.forEach((url, index) => addReference("video", index, "video", url));
  input.referenceAudioUrls?.forEach((url, index) => addReference("audio", index, "audio", url));

  const params = input.modelParams ?? {};
  const values: Record<string, unknown> = {
    ...params,
    prompt: promptForRoute(input, route),
    ...(input.aspectRatio !== undefined ? { aspectRatio: input.aspectRatio } : {}),
    ...(input.duration !== undefined ? { duration: input.duration } : {}),
  };
  return {
    request: {
      pluginId: route.projectorPluginId,
      exportId: route.projectorExportId,
      kind,
      taskId: input.taskId,
      projectId: input.projectId ?? "local",
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      ...(input.pluginBinding ? { binding: input.pluginBinding } : {}),
      input: { values, references },
    },
    assetUrls,
  };
}

function materializeProviderPluginAssets(value: unknown, assetUrls: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") {
    if (!value.startsWith("clash-asset://")) return value;
    const url = assetUrls.get(value);
    if (!url) throw new Error(`Provider plugin returned an unknown asset handle: ${value}`);
    return url;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => materializeProviderPluginAssets(entry, assetUrls));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      materializeProviderPluginAssets(entry, assetUrls),
    ]));
  }
  return value;
}

function providerPluginExecutorRequest(
  input: MockMediaGenerationInput,
  kind: ModelKind,
  route: ModelUpstreamRoute,
): ProviderPluginExecutorRequest {
  if (!route.executorPluginId || !route.executorExportId) {
    throw new Error(`Route ${route.modelCode} has no executable provider executor.`);
  }
  if (input.pluginBinding && (
    input.pluginBinding.pluginId !== route.executorPluginId
    || input.pluginBinding.exportId !== route.executorExportId
  )) {
    throw new Error(
      `Pinned plugin ${input.pluginBinding.pluginId}/${input.pluginBinding.exportId} does not match `
        + `route executor ${route.executorPluginId}/${route.executorExportId}.`,
    );
  }
  return {
    pluginId: route.executorPluginId,
    exportId: route.executorExportId,
    kind,
    taskId: input.taskId,
    projectId: input.projectId ?? "local",
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    ...(input.pluginBinding ? { binding: input.pluginBinding } : {}),
    // Carried through untouched. Dropping it here silently turns every resume into a fresh
    // submission: the node keeps its record, the plugin never sees it, and the same generation is
    // bought again on every restart.
    ...(input.pollState === undefined ? {} : { pollState: input.pollState }),
    input: {
      values: {
        modelId: route.modelCode,
        upstreamModel: route.upstreamModel,
        prompt: promptForRoute(input, route),
        ...(input.aspectRatio !== undefined ? { aspectRatio: input.aspectRatio } : {}),
        ...(input.duration !== undefined ? { duration: input.duration } : {}),
        modelParams: input.modelParams ?? {},
        ...(input.startFrameUrl ? { startFrameUrl: input.startFrameUrl } : {}),
        ...(input.endFrameUrl ? { endFrameUrl: input.endFrameUrl } : {}),
        ...(input.referenceImageUrls?.length ? { referenceImageUrls: input.referenceImageUrls } : {}),
        ...(input.referenceVideoUrls?.length ? { referenceVideoUrls: input.referenceVideoUrls } : {}),
        ...(input.referenceAudioUrls?.length ? { referenceAudioUrls: input.referenceAudioUrls } : {}),
      },
      references: [],
    },
  };
}

/**
 * Polls an accepted generation until it finishes.
 *
 * For a caller with a client waiting on an open socket and nowhere to put an acceptance. The canvas
 * processor does not use this -- it stores the poll state on the node, which is what survives a
 * restart.
 */
export async function settleAcceptedGeneration(
  first: MockMediaGenerationResult,
  poll: (pollState: unknown) => Promise<MockMediaGenerationResult>,
  options: { now?: () => number; sleep?: (ms: number) => Promise<void>; budgetMs?: number } = {},
): Promise<MockMediaGenerationCompleted> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const budgetMs = options.budgetMs ?? 15 * 60 * 1000;
  const deadline = now() + budgetMs;
  let current = first;
  while (current.status === "accepted") {
    if (now() >= deadline) {
      throw new Error(
        "Provider did not finish within the request budget. The work may still be running upstream.",
      );
    }
    await sleep(Math.max(1000, current.retryAfterMs ?? 5000));
    current = await poll(current.pollState);
  }
  return current;
}

async function generatePluginProviderMedia(
  input: MockMediaGenerationInput,
  kind: ModelKind,
  route: ModelUpstreamRoute,
  options: Required<Pick<MockFalExternalAigcServiceOptions, "fetch" | "providerPluginExecutor">>,
  // The one path that can come back unfinished: a plugin may hand the work to a provider that
  // takes minutes, and say so instead of holding the call open.
): Promise<MockMediaGenerationResult> {
  const [startFrameUrl, endFrameUrl, referenceImageUrls, referenceVideoUrls, referenceAudioUrls] =
    await Promise.all([
      input.startFrameUrl
        ? inlineLoopbackReference(options.fetch, input.startFrameUrl)
        : Promise.resolve(undefined),
      input.endFrameUrl
        ? inlineLoopbackReference(options.fetch, input.endFrameUrl)
        : Promise.resolve(undefined),
      Promise.all((input.referenceImageUrls ?? []).map((url) =>
        inlineLoopbackReference(options.fetch, url))),
      Promise.all((input.referenceVideoUrls ?? []).map((url) =>
        inlineLoopbackReference(options.fetch, url))),
      Promise.all((input.referenceAudioUrls ?? []).map((url) =>
        inlineLoopbackReference(options.fetch, url))),
    ]);
  const response = await options.providerPluginExecutor(
    providerPluginExecutorRequest({
      ...input,
      ...(startFrameUrl ? { startFrameUrl } : {}),
      ...(endFrameUrl ? { endFrameUrl } : {}),
      ...(referenceImageUrls.length ? { referenceImageUrls } : {}),
      ...(referenceVideoUrls.length ? { referenceVideoUrls } : {}),
      ...(referenceAudioUrls.length ? { referenceAudioUrls } : {}),
    }, kind, route),
  );
  if (response.binding.pluginId !== route.executorPluginId
    || response.binding.exportId !== route.executorExportId) {
    throw new Error(
      `Provider plugin resolved ${response.binding.pluginId}/${response.binding.exportId}, expected `
        + `${route.executorPluginId}/${route.executorExportId}.`,
    );
  }
  if (input.pluginBinding && (
    response.binding.version !== input.pluginBinding.version
    || response.binding.schemaHash !== input.pluginBinding.schemaHash
  )) {
    throw new Error(
      `Provider plugin binding drifted from ${input.pluginBinding.version}/${input.pluginBinding.schemaHash}.`,
    );
  }
  if (response.status === "accepted") {
    // Not an error and not a result: the provider holds the work. Carrying it out as a value lets
    // the caller persist the poll state; throwing here would make an acceptance look like a failure
    // to every catch on the way up, and this one has already been billed.
    return {
      status: "accepted",
      pollState: response.pollState,
      ...(response.retryAfterMs === undefined ? {} : { retryAfterMs: response.retryAfterMs }),
      pluginBinding: response.binding,
      provider: route.providerId ?? route.upstreamId,
      modelEndpoint: route.upstreamModel,
    };
  }
  const downloaded = await downloadProviderMedia(options.fetch, response.media.url, kind);
  return {
    ...downloaded,
    ...(response.media.contentType ? { contentType: response.media.contentType } : {}),
    ...(response.media.width !== undefined ? { width: response.media.width } : {}),
    ...(response.media.height !== undefined ? { height: response.media.height } : {}),
    ...(response.media.durationMs !== undefined ? { durationMs: response.media.durationMs } : {}),
    ...(response.media.waveform ? { waveform: response.media.waveform } : {}),
    ...(response.media.transcript ? { transcript: response.media.transcript } : {}),
    status: "completed" as const,
    requestId: response.media.requestId ?? input.taskId,
    provider: route.providerId ?? route.upstreamId,
    modelEndpoint: route.upstreamModel,
    pluginBinding: response.binding,
  };
}

async function generateFalMedia(
  input: MockMediaGenerationInput,
  kind: ModelKind,
  route: ModelUpstreamRoute,
  options: Required<Pick<MockFalExternalAigcServiceOptions, "fetch">> &
    Pick<MockFalExternalAigcServiceOptions, "falQueueBaseUrl" | "providerPluginProjector">,
  apiKey: string,
): Promise<MockMediaGenerationCompleted> {
  const queueBaseUrl = normalizeBaseUrl(options.falQueueBaseUrl, "https://queue.fal.run");
  let pluginBinding: ExecutablePluginBinding | undefined;
  let endpoint = "";
  let requestBody: Record<string, unknown> = {};
  let pluginProjected = false;
  if (route.projectorPluginId && route.projectorExportId && options.providerPluginProjector) {
    try {
      const { request, assetUrls } = providerPluginProjectionRequest(input, kind, route);
      const response = await options.providerPluginProjector(request);
      if (response.binding.pluginId !== route.projectorPluginId
        || response.binding.exportId !== route.projectorExportId) {
        throw new Error(
          `Provider plugin resolved ${response.binding.pluginId}/${response.binding.exportId}, expected `
            + `${route.projectorPluginId}/${route.projectorExportId}.`,
        );
      }
      if (input.pluginBinding && (
        response.binding.version !== input.pluginBinding.version
        || response.binding.schemaHash !== input.pluginBinding.schemaHash
      )) {
        throw new Error(
          `Provider plugin binding drifted from ${input.pluginBinding.version}/${input.pluginBinding.schemaHash}.`,
        );
      }
      pluginBinding = response.binding;
      endpoint = response.projection.endpoint.replace(/^\/+/, "");
      requestBody = materializeProviderPluginAssets(
        response.projection.input,
        assetUrls,
      ) as Record<string, unknown>;
      pluginProjected = true;
    } catch (error) {
      // Existing unpinned nodes retain their legacy adapter while the Bridge
      // daemon is absent. Pinned nodes must never silently change semantics.
      if (!(error instanceof ProviderPluginHostUnavailableError) || input.pluginBinding) throw error;
    }
  }
  if (!pluginProjected) {
    endpoint = falEndpoint(input, kind, route).replace(/^\/+/, "");
    const executionRoute = endpoint === route.upstreamModel
      ? route
      : { ...route, upstreamModel: endpoint };
    requestBody = falInput(input, kind, executionRoute);
  }
  const headers = {
    authorization: `Key ${apiKey}`,
    "content-type": "application/json",
  };
  const submittedResponse = await options.fetch(`${queueBaseUrl}/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
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
    modelEndpoint: endpoint,
    remoteUrl: media.url,
    ...(pluginBinding ? { pluginBinding } : {}),
  };
}

function providerInput(input: MockMediaGenerationInput, kind: ModelKind, route?: ModelUpstreamRoute): Record<string, unknown> {
  const params = input.modelParams ?? {};
  const body: Record<string, unknown> = {
    prompt: route ? promptForRoute(input, route) : input.prompt,
    ...params,
  };
  if (input.aspectRatio) body.aspect_ratio = input.aspectRatio;
  if (kind === "video") {
    body.duration = input.duration ?? params.duration ?? 5;
    if (route?.modelCode === "seedance-2-ref" && route.apiShape === "kie") {
      if (input.referenceImageUrls?.length) body.reference_image_urls = input.referenceImageUrls;
      if (input.referenceVideoUrls?.length) body.reference_video_urls = input.referenceVideoUrls;
      if (input.referenceAudioUrls?.length) body.reference_audio_urls = input.referenceAudioUrls;
    }
    if (route?.modelCode === "seedance-2-ref" && route.apiShape === "replicate") {
      if (input.referenceImageUrls?.length) body.reference_images = input.referenceImageUrls;
      if (input.referenceVideoUrls?.length) body.reference_videos = input.referenceVideoUrls;
      if (input.referenceAudioUrls?.length) body.reference_audios = input.referenceAudioUrls;
    }
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
): Promise<Pick<MockMediaGenerationCompleted, "bytes" | "contentType" | "remoteUrl">> {
  const mediaResponse = await fetchImpl(mediaUrl);
  if (!mediaResponse.ok) throw new Error(`provider media download failed: ${mediaResponse.status}`);
  return {
    bytes: new Uint8Array(await mediaResponse.arrayBuffer()),
    contentType: mediaResponse.headers.get("content-type") ?? defaultContentType(kind),
    remoteUrl: mediaUrl,
  };
}

async function inlineLoopbackReference(fetchImpl: typeof fetch, mediaUrl: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(mediaUrl);
  } catch {
    return mediaUrl;
  }
  if (
    url.hostname !== "127.0.0.1"
    && url.hostname !== "localhost"
    && url.hostname !== "::1"
    && url.hostname !== "[::1]"
  ) {
    return mediaUrl;
  }
  const response = await fetchImpl(mediaUrl);
  if (!response.ok) {
    throw new Error(`Local MiniMax reference read failed: ${response.status}`);
  }
  const contentType = (response.headers.get("content-type") || "application/octet-stream")
    .split(";", 1)[0]
    .toLowerCase();
  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:${referenceDataUrlMimeType(contentType)};base64,${bytes.toString("base64")}`;
}

async function generateBflVideoMedia(
  input: MockMediaGenerationInput,
  route: ModelUpstreamRoute,
  options: Required<Pick<MockFalExternalAigcServiceOptions, "fetch">> &
    Pick<MockFalExternalAigcServiceOptions, "bflBaseUrl">,
  apiKey: string,
  accountBaseUrl?: string,
): Promise<MockMediaGenerationCompleted> {
  const [referenceImageUrls, referenceVideoUrls] = await Promise.all([
    Promise.all((input.referenceImageUrls ?? []).map((url) => inlineLoopbackReference(options.fetch, url))),
    Promise.all((input.referenceVideoUrls ?? []).map((url) => inlineLoopbackReference(options.fetch, url))),
  ]);
  const result = await generateBflFlux3Video({
    apiKey,
    baseUrl: accountBaseUrl || options.bflBaseUrl,
    fetch: options.fetch,
    pollIntervalMs: 0,
    input: {
      prompt: promptForRoute(input, route),
      duration: input.duration,
      aspectRatio: input.aspectRatio,
      modelParams: input.modelParams,
      referenceImageUrls,
      referenceVideoUrls,
    },
  });
  const media = await downloadProviderMedia(options.fetch, result.url, "video");
  const duration = input.duration ?? numberParam(input.modelParams, "duration", Number.NaN);
  return {
    ...media,
    requestId: result.requestId,
    provider: "bfl",
    modelEndpoint: route.upstreamModel,
    ...(typeof duration === "number" && Number.isFinite(duration) ? { durationMs: duration * 1000 } : {}),
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
): Promise<MockMediaGenerationCompleted> {
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
      input: providerInput(input, kind, route),
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

async function generateSunoMedia(
  input: MockMediaGenerationInput,
  route: ModelUpstreamRoute,
  options: Required<Pick<MockFalExternalAigcServiceOptions, "fetch">> &
    Pick<MockFalExternalAigcServiceOptions, "sunoBaseUrl">,
  apiKey: string,
  callbackUrl: string | undefined,
): Promise<MockMediaGenerationCompleted> {
  if (!callbackUrl || !/^https:\/\//.test(callbackUrl)) {
    throw new Error("Suno provider account requires a public HTTPS callbackUrl.");
  }
  const baseUrl = normalizeBaseUrl(options.sunoBaseUrl, "https://api.sunoapi.org");
  const style = stringParam(input.modelParams, "style");
  const title = stringParam(input.modelParams, "title");
  const customMode = !!(style || title);
  if (customMode && (!style || !title)) {
    throw new Error("Suno custom mode requires both style and title.");
  }
  const headers = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };
  const createResponse = await options.fetch(`${baseUrl}/api/v1/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      customMode,
      instrumental: input.modelParams?.instrumental === true,
      model: route.upstreamModel,
      callBackUrl: callbackUrl,
      prompt: input.prompt,
      ...(customMode ? { style, title } : {}),
    }),
  });
  const created = await responseJson(createResponse);
  if (!createResponse.ok || created?.code !== 200) {
    throw new Error(`Suno API request failed: ${created?.msg ?? createResponse.statusText}`);
  }
  const taskId = created?.data?.taskId;
  if (typeof taskId !== "string" || !taskId) {
    throw new Error(`Suno API response returned no taskId for ${route.upstreamModel}`);
  }

  const failures = new Set([
    "CREATE_TASK_FAILED",
    "GENERATE_AUDIO_FAILED",
    "CALLBACK_EXCEPTION",
    "SENSITIVE_WORD_ERROR",
  ]);
  let task: any = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const statusResponse = await options.fetch(
      `${baseUrl}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
      { method: "GET", headers: { authorization: `Bearer ${apiKey}` } },
    );
    task = await responseJson(statusResponse);
    if (!statusResponse.ok || task?.code !== 200) {
      throw new Error(`Suno API status failed: ${task?.msg ?? statusResponse.statusText}`);
    }
    const status = String(task?.data?.status ?? "PENDING");
    if (failures.has(status)) {
      throw new Error(`Suno API generation failed: ${task?.data?.errorMessage ?? status}`);
    }
    if (status === "SUCCESS") break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (task?.data?.status !== "SUCCESS") {
    throw new Error(`Suno API generation timed out: ${taskId}`);
  }
  const song = task?.data?.response?.sunoData?.[0];
  const mediaUrl = typeof song?.audioUrl === "string" ? song.audioUrl : undefined;
  if (!mediaUrl) throw new Error(`Suno API response returned no audioUrl for ${taskId}`);
  const media = await downloadProviderMedia(options.fetch, mediaUrl, "audio");
  return {
    ...media,
    requestId: taskId,
    provider: "suno",
    modelEndpoint: route.upstreamModel,
    ...(typeof song.duration === "number" ? { durationMs: Math.round(song.duration * 1000) } : {}),
  };
}

async function generateMiniMaxMedia(
  input: MockMediaGenerationInput,
  kind: ModelKind,
  route: ModelUpstreamRoute,
  options: Required<Pick<MockFalExternalAigcServiceOptions, "fetch">> &
    Pick<MockFalExternalAigcServiceOptions, "minimaxBaseUrl">,
  apiKey: string,
  accountBaseUrl?: string,
): Promise<MockMediaGenerationCompleted> {
  const baseUrl = normalizeBaseUrl(accountBaseUrl || options.minimaxBaseUrl, "https://api.minimax.io");
  const headers = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };

  if (kind === "audio") {
    const isMusic = route.upstreamModel.startsWith("music-");
    // Speech defaults to WAV, music to MP3.
    //
    // Both carry the same audio, but the media type decides what downstreams that derive
    // a filename from it will call the file: `audio/wav` yields `.wav`, while MP3's
    // registered `audio/mpeg` yields `.mpeg`, which one upstream rejects outright. Speech
    // clips are short and routinely fed back in as references to this product's own video
    // models, so the unambiguous type is worth the size. A music track is minutes long and
    // is the finished artefact rather than an input, so it stays compressed.
    const format = stringParam(input.modelParams, "format") || (isMusic ? "mp3" : "wav");
    const body = isMusic
      ? {
          model: route.upstreamModel,
          prompt: input.prompt,
          lyrics: stringParam(input.modelParams, "lyrics") || "",
          stream: false,
          output_format: "hex",
          lyrics_optimizer: input.modelParams?.lyrics_optimizer === true,
          is_instrumental: input.modelParams?.is_instrumental === true,
          aigc_watermark: input.modelParams?.aigc_watermark === true,
          audio_setting: {
            sample_rate: numberParam(input.modelParams, "sample_rate", 44100),
            bitrate: numberParam(input.modelParams, "bitrate", 256000),
            format,
          },
        }
      : {
          model: route.upstreamModel,
          text: input.prompt,
          stream: false,
          output_format: "hex",
          voice_setting: {
            voice_id: stringParam(input.modelParams, "voice_id") || "female-warm",
            speed: Number(input.modelParams?.speed ?? 1),
            pitch: Number(input.modelParams?.pitch ?? 0),
          },
          audio_setting: {
            sample_rate: numberParam(input.modelParams, "sample_rate", 32000),
            bitrate: numberParam(input.modelParams, "bitrate", 128000),
            format,
            channel: numberParam(input.modelParams, "channel", 1),
          },
        };
    const response = await options.fetch(
      `${baseUrl}${isMusic ? "/v1/music_generation" : "/v1/t2a_v2"}`,
      { method: "POST", headers, body: JSON.stringify(body) },
    );
    const json = await responseJson(response);
    if (!response.ok || json?.base_resp?.status_code !== 0) {
      throw new Error(`MiniMax ${isMusic ? "music" : "TTS"} request failed: ${json?.base_resp?.status_msg ?? response.statusText}`);
    }
    const audio = json?.data?.audio;
    if (typeof audio !== "string" || !audio) {
      throw new Error(`MiniMax ${isMusic ? "music" : "TTS"} response returned no audio.`);
    }
    return {
      bytes: hexToBytes(audio),
      contentType: format === "wav" ? "audio/wav" : format === "pcm" ? "audio/L16" : "audio/mpeg",
      requestId: input.taskId,
      provider: "minimax",
      modelEndpoint: route.upstreamModel,
      ...(typeof json?.extra_info?.music_duration === "number"
        ? { durationMs: json.extra_info.music_duration }
        : {}),
    };
  }

  if (kind !== "video") throw missingAdapter(route);
  const orderedContentParts = await Promise.all((input.orderedContentParts ?? []).map(async (part) =>
    part.type === "text"
      ? part
      : { ...part, url: await inlineLoopbackReference(options.fetch, part.url) },
  ));
  const [startFrame, endFrame, referenceImages, referenceVideos, referenceAudios] = await Promise.all([
    input.startFrameUrl ? inlineLoopbackReference(options.fetch, input.startFrameUrl) : Promise.resolve(undefined),
    input.endFrameUrl ? inlineLoopbackReference(options.fetch, input.endFrameUrl) : Promise.resolve(undefined),
    Promise.all((input.referenceImageUrls ?? []).map((url) => inlineLoopbackReference(options.fetch, url))),
    Promise.all((input.referenceVideoUrls ?? []).map((url) => inlineLoopbackReference(options.fetch, url))),
    Promise.all((input.referenceAudioUrls ?? []).map((url) => inlineLoopbackReference(options.fetch, url))),
  ]);
  if (endFrame && !startFrame) {
    throw new Error("MiniMax H3 end frame requires a start frame.");
  }
  const orderedMediaTypes = new Set(
    orderedContentParts.filter((part) => part.type !== "text").map((part) => part.type),
  );
  if (startFrame && (
    referenceImages.length || referenceVideos.length || referenceAudios.length || orderedMediaTypes.size
  )) {
    throw new Error("MiniMax H3 start/end frames cannot be mixed with omni references.");
  }
  const hasReferenceAudio = referenceAudios.length > 0 || orderedMediaTypes.has("audio");
  const hasReferenceVisual = referenceImages.length > 0 || referenceVideos.length > 0 ||
    orderedMediaTypes.has("image") || orderedMediaTypes.has("video");
  if (hasReferenceAudio && !hasReferenceVisual) {
    throw new Error("MiniMax H3 reference audio requires at least one reference image or video.");
  }
  const content = buildMiniMaxH3Content({
    prompt: input.prompt,
    orderedContentParts,
    startFrame,
    endFrame,
    referenceImages,
    referenceVideos,
    referenceAudios,
  });
  const createResponse = await options.fetch(`${baseUrl}/v2/video_generation`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: route.upstreamModel,
      content,
      resolution: stringParam(input.modelParams, "resolution") || "2K",
      duration: input.duration ?? numberParam(input.modelParams, "duration", 5),
      ratio: startFrame ? "adaptive" : input.aspectRatio || stringParam(input.modelParams, "aspect_ratio") || "16:9",
    }),
  });
  const created = await responseJson(createResponse);
  if (!createResponse.ok) {
    throw new Error(`MiniMax H3 request failed: ${created?.error?.message ?? created?.message ?? createResponse.statusText}`);
  }
  const taskId = created?.task_id;
  if (typeof taskId !== "string" || !taskId) {
    throw new Error("MiniMax H3 response returned no task_id.");
  }

  let task: any;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const statusResponse = await options.fetch(
      `${baseUrl}/v2/query/video_generation/${encodeURIComponent(taskId)}`,
      { headers: { authorization: `Bearer ${apiKey}` } },
    );
    const json = await responseJson(statusResponse);
    if (!statusResponse.ok) {
      throw new Error(`MiniMax H3 status failed: ${json?.error?.message ?? json?.message ?? statusResponse.statusText}`);
    }
    task = json?.task;
    const status = String(task?.status ?? "queued").toLowerCase();
    if (status === "succeeded") break;
    if (status === "failed" || status === "cancelled") {
      throw new Error(`MiniMax H3 generation failed: ${task?.error?.message ?? task?.message ?? status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (String(task?.status ?? "").toLowerCase() !== "succeeded") {
    throw new Error(`MiniMax H3 generation timed out: ${taskId}`);
  }
  const mediaUrl = task?.content?.url;
  if (typeof mediaUrl !== "string" || !mediaUrl) {
    throw new Error(`MiniMax H3 response returned no video URL for ${taskId}`);
  }
  const media = await downloadProviderMedia(options.fetch, mediaUrl, "video");
  return {
    ...media,
    requestId: taskId,
    provider: "minimax",
    modelEndpoint: route.upstreamModel,
    ...(typeof task.duration === "number" ? { durationMs: task.duration * 1000 } : {}),
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
): Promise<MockMediaGenerationCompleted> {
  const baseUrl = normalizeBaseUrl(options.replicateBaseUrl, "https://api.replicate.com/v1");
  const headers = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };
  const createResponse = await options.fetch(replicatePredictionUrl(baseUrl, route.upstreamModel), {
    method: "POST",
    headers,
    body: JSON.stringify({
      input: providerInput(input, kind, route),
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

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function pikaOperation(
  input: MockMediaGenerationInput,
  kind: ModelKind,
  route: ModelUpstreamRoute,
  references: { images: string[]; videos: string[]; audios: string[] },
): string {
  if (route.modelCode === "pika-2.5") {
    return references.images.length || input.startFrameUrl
      ? "pika/pika-2.5/image-to-video"
      : "pika/pika-2.5/text-to-video";
  }
  if (route.modelCode === "flux-3-video") {
    return references.images.length || input.startFrameUrl
      ? "black-forest-labs/flux-3-video/image-to-video"
      : "black-forest-labs/flux-3-video/text-to-video";
  }
  if (route.modelCode === "kling-3") {
    return references.images.length || input.startFrameUrl
      ? "kling/kling-3.0/image-to-video"
      : "kling/kling-3.0/text-to-video";
  }
  if (kind === "image") {
    return references.images.length
      ? route.upstreamModel.replace(/\/text-to-image$/, "/image-to-image")
      : route.upstreamModel;
  }
  if (route.modelCode === "minimax-h3" && !references.images.length && !references.videos.length && !references.audios.length) {
    return "minimax/h3/text-to-video";
  }
  return route.upstreamModel;
}

async function pikaReferenceUrl(
  mediaUrl: string | undefined,
  options: Required<Pick<MockFalExternalAigcServiceOptions, "fetch">> & Pick<MockFalExternalAigcServiceOptions, "pikaBaseUrl">,
  apiKey: string,
): Promise<string | undefined> {
  if (!mediaUrl) return undefined;
  const reference = await loadReferenceData(options.fetch, mediaUrl);
  return uploadPikaMedia({
    apiKey,
    bytes: reference.data,
    contentType: reference.mediaType,
    baseUrl: options.pikaBaseUrl,
    fetch: options.fetch,
  });
}

function pikaInput(
  input: MockMediaGenerationInput,
  route: ModelUpstreamRoute,
  operation: string,
  references: {
    start?: string;
    end?: string;
    images: string[];
    videos: string[];
    audios: string[];
  },
): Record<string, unknown> {
  const params = input.modelParams ?? {};
  const prompt = promptForRoute(input, route);
  if (route.modelCode === "nano-banana-2") {
    return compactRecord({
      prompt,
      num_images: params.count ?? 1,
      aspect_ratio: input.aspectRatio ?? params.aspect_ratio ?? "1:1",
      output_format: params.output_format ?? "png",
      resolution: params.resolution ?? "1K",
      image_urls: references.images.length ? references.images : undefined,
    });
  }
  if (route.modelCode === "gpt-image-2") {
    return compactRecord({
      prompt,
      num_images: params.count ?? 1,
      aspect_ratio: input.aspectRatio,
      output_format: params.output_format ?? "png",
      resolution: params.resolution,
      quality: params.quality,
      background: params.background,
      size: params.size,
      image_urls: references.images.length ? references.images : undefined,
    });
  }
  if (route.modelCode === "seedream-5-pro" || route.modelCode === "recraft-v4") {
    return compactRecord({ prompt, num_images: params.count ?? 1, size: params.size, image_urls: references.images.length ? references.images : undefined });
  }
  if (route.modelCode === "grok-imagine-quality") {
    return compactRecord({ prompt, num_images: params.count ?? 1, resolution: params.resolution ?? "2K", aspect_ratio: input.aspectRatio ?? "1:1", image_url: references.images[0] });
  }
  if (route.modelCode === "pika-2.5") {
    return compactRecord({
      prompt,
      resolution: params.resolution ?? "720p",
      duration_s: input.duration ?? params.duration ?? 5,
      negative_prompt: params.negative_prompt,
      seed: params.seed,
      image: references.start ?? references.images[0],
    });
  }
  if (route.modelCode === "flux-3-video") {
    return compactRecord({ prompt, duration: input.duration ?? params.duration ?? "auto", resolution: params.resolution ?? "720p", aspect_ratio: input.aspectRatio ?? params.aspect_ratio ?? "auto", draft: params.mode === "draft", generate_audio: params.generate_audio ?? true, image_url: references.start ?? references.images[0] });
  }
  if (route.modelCode === "kling-3") {
    return compactRecord({ prompt, duration: Number(input.duration ?? params.duration ?? 5), resolution: params.resolution ?? "720p", aspect_ratio: input.aspectRatio ?? "16:9", audio: params.generate_audio === false ? "off" : "native", image_url: references.start ?? references.images[0], last_frame_url: references.end });
  }
  if (route.modelCode === "grok-imagine-video-1.5") {
    return compactRecord({ prompt, duration: input.duration ?? params.duration ?? 6, image_url: references.start ?? references.images[0], aspect_ratio: input.aspectRatio, resolution: params.resolution ?? "720p" });
  }
  if (route.modelCode === "seedance-2-startend") {
    return compactRecord({
      prompt,
      duration: input.duration ?? params.duration ?? "auto",
      ratio: input.aspectRatio ?? params.aspect_ratio,
      generate_audio: params.generate_audio,
      watermark: false,
      image_url: references.start ?? references.images[0],
      end_image_url: references.end,
      resolution: params.resolution ?? "720p",
    });
  }
  if (route.modelCode === "seedance-2-ref") {
    return compactRecord({
      prompt,
      duration: input.duration ?? params.duration ?? "auto",
      ratio: input.aspectRatio ?? params.aspect_ratio,
      generate_audio: params.generate_audio,
      watermark: false,
      image_urls: references.images.length ? references.images : undefined,
      video_urls: references.videos.length ? references.videos : undefined,
      audio_urls: references.audios.length ? references.audios : undefined,
      resolution: params.resolution ?? "720p",
    });
  }
  if (route.modelCode === "minimax-h3" || route.modelCode === "minimax-h3-startend") {
    return compactRecord({
      prompt,
      duration: input.duration ?? params.duration ?? 5,
      resolution: params.resolution ?? "2K",
      seed: params.seed,
      aigc_watermark: params.aigc_watermark,
      ratio: operation.endsWith("text-to-video") || operation.endsWith("reference-to-video")
        ? input.aspectRatio ?? params.aspect_ratio ?? (operation.endsWith("reference-to-video") ? "adaptive" : "16:9")
        : undefined,
      first_frame_image: references.start,
      last_frame_image: references.end,
      image_urls: references.images.length ? references.images : undefined,
      video_urls: references.videos.length ? references.videos : undefined,
      audio_urls: references.audios.length ? references.audios : undefined,
    });
  }
  if (route.modelCode === "minimax-music-3") {
    return compactRecord({
      prompt,
      lyrics: params.lyrics,
      lyrics_optimizer: params.lyrics_optimizer ?? false,
      is_instrumental: params.is_instrumental ?? false,
      audio_setting: compactRecord({
        sample_rate: params.sample_rate,
        bitrate: params.bitrate,
        format: params.format,
      }),
    });
  }
  if (route.modelCode === "lyria-3-pro") return { prompt };
  if (route.modelCode === "minimax-speech-2.8-hd") {
    return compactRecord({ text: prompt, voice_id: params.voice_id ?? "English_Graceful_Lady", speed: params.speed, vol: params.vol, pitch: params.pitch, emotion: params.emotion, sample_rate: params.sample_rate, bitrate: params.bitrate, format: params.format, channel: params.channel, language_boost: params.language_boost });
  }
  throw new Error(`Pika API Club does not implement ${route.modelCode}`);
}

async function generatePikaMedia(
  input: MockMediaGenerationInput,
  kind: ModelKind,
  route: ModelUpstreamRoute,
  options: Required<Pick<MockFalExternalAigcServiceOptions, "fetch">> & Pick<MockFalExternalAigcServiceOptions, "pikaBaseUrl" | "providerUsageAudit">,
  apiKey: string,
): Promise<MockMediaGenerationCompleted> {
  const [start, end, images, videos, audios] = await Promise.all([
    pikaReferenceUrl(input.startFrameUrl, options, apiKey),
    pikaReferenceUrl(input.endFrameUrl, options, apiKey),
    Promise.all((input.referenceImageUrls ?? []).map((url) => pikaReferenceUrl(url, options, apiKey) as Promise<string>)),
    Promise.all((input.referenceVideoUrls ?? []).map((url) => pikaReferenceUrl(url, options, apiKey) as Promise<string>)),
    Promise.all((input.referenceAudioUrls ?? []).map((url) => pikaReferenceUrl(url, options, apiKey) as Promise<string>)),
  ]);
  const references = { start, end, images, videos, audios };
  const operation = pikaOperation(input, kind, route, references);
  const body = pikaInput(input, route, operation, references);
  const quote = await fetchPikaCatalogQuote({
    operation,
    input: body,
    baseUrl: options.pikaBaseUrl,
    fetch: options.fetch,
  });
  const billingBasis = pikaBillingBasis(body);
  const emit = async (
    status: "submitted" | "completed" | "failed",
    providerRequestId?: string,
    error?: unknown,
  ) => options.providerUsageAudit?.({
    id: `${input.taskId}:pika:${providerRequestId ?? "submit"}:${status}`,
    userId: input.actorUserId ?? "local-user",
    providerId: "pika",
    ...(route.accountId ? { providerAccountId: route.accountId } : {}),
    modelId: route.modelCode,
    operation,
    taskId: input.taskId,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    actorType: input.actorType ?? "user",
    actorUserId: input.actorUserId ?? "local-user",
    ...(input.actorAgentId ? { actorAgentId: input.actorAgentId } : {}),
    ...(providerRequestId ? { providerRequestId } : {}),
    idempotencyKey: input.taskId,
    status,
    ...(quote.estimatedCostMicroUsd !== undefined
      ? { estimatedCostMicroUsd: quote.estimatedCostMicroUsd }
      : {}),
    estimateComplete: quote.complete,
    currency: "USD",
    pricingSource: quote.pricingSource,
    billingBasis,
    ...(error ? { errorMessage: error instanceof Error ? error.message : String(error) } : {}),
    occurredAt: new Date().toISOString(),
  });
  let created;
  try {
    created = await createPikaMediaJob({
      apiKey,
      operation,
      input: body,
      idempotencyKey: input.taskId,
      baseUrl: options.pikaBaseUrl,
      fetch: options.fetch,
    });
  } catch (error) {
    await emit("failed", undefined, error);
    throw error;
  }
  await emit("submitted", created.id);
  let completed;
  try {
    completed = created.status === "completed"
      ? created
      : await waitForPikaMediaJob({
          apiKey,
          jobId: created.id,
          baseUrl: options.pikaBaseUrl,
          fetch: options.fetch,
        });
    await emit("completed", completed.id);
  } catch (error) {
    await emit("failed", created.id, error);
    throw error;
  }
  const content = await getPikaMediaContent({
    apiKey,
    jobId: completed.id,
    baseUrl: options.pikaBaseUrl,
    fetch: options.fetch,
  });
  const media = await downloadProviderMedia(options.fetch, content.url, kind);
  return {
    ...media,
    requestId: completed.id,
    provider: "pika",
    modelEndpoint: operation,
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
  const loadModelCards = options.modelCards;

  const providerIdForRoute = (route: ModelUpstreamRoute) => {
    if (route.providerId) return route.providerId;
    if (
      route.upstreamId === "openai" ||
      route.upstreamId === "google-ai-studio" ||
      route.upstreamId === "google-agent-platform" ||
      route.upstreamId === "anthropic" ||
      route.upstreamId === "bfl"
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
        (!route.accountId || account.id === route.accountId) &&
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
      modelRouteCredentialsSatisfied(route, {
        ...account,
        configuredCredentials: [
          ...new Set([
            ...(account.configuredCredentials ?? []),
            ...Object.entries(account.credentials ?? {})
              .filter(([, value]) => typeof value === "string" && value.trim())
              .map(([key]) => key),
          ]),
        ],
      });
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

  const providerFetchForRoute = async (route: ModelUpstreamRoute): Promise<typeof fetch> => {
    const traffic = options.providerTraffic;
    if (!traffic) return fetchImpl;
    const stub = createProviderConformanceStubs({ includeMock: route.upstreamId === "mock" })
      .find((candidate) =>
        candidate.providerId === providerIdForRoute(route)
        && candidate.upstreamId === route.upstreamId
        && (candidate.region ?? "") === (route.region ?? "")
        && candidate.modelId === route.modelCode
        && candidate.apiShape === route.apiShape
      );
    if (!stub) {
      throw new Error(`Provider traffic ${traffic.mode} has no conformance stub for ${route.modelCode}/${route.apiShape}.`);
    }
    if (traffic.mode === "record") {
      return createProviderTestRecordingFetch({
        fetch: fetchImpl,
        recorder: await traffic.recorder(),
        stub,
      });
    }
    const fixtures = filterProviderTestReplayFixturesForStub(await traffic.fixtures(), stub.id);
    if (!fixtures.length) {
      throw new Error(`Provider traffic replay has no fixtures for ${stub.id}.`);
    }
    return createProviderTestReplayFetch(fixtures);
  };

  const googleAiStudioReplayAccount = async (
    input: MockMediaGenerationInput,
    kind: ModelKind,
  ): Promise<RuntimeProviderAccountAvailability | undefined> => {
    const traffic = options.providerTraffic;
    if (traffic?.mode !== "replay") return undefined;
    const modelId = normalizeModelId(input.model) ?? input.model.trim();
    const fixture = (await traffic.fixtures()).find((candidate) =>
      candidate.stub.providerId === "official"
      && candidate.stub.upstreamId === "google-ai-studio"
      && candidate.stub.apiShape === "google-ai-studio-interactions"
      && candidate.stub.modelId === modelId
      && candidate.stub.shape === kind
      && /\/v\d+(?:beta\d*)?\/interactions\/?$/.test(new URL(candidate.request.url).pathname)
    );
    if (!fixture) return undefined;
    const url = new URL(fixture.request.url);
    url.pathname = url.pathname.replace(/\/v\d+(?:beta\d*)?\/interactions\/?$/, "");
    url.search = "";
    url.hash = "";
    const baseUrl = url.toString().replace(/\/$/, "");
    return {
      id: "google-ai-studio-provider-traffic-replay",
      providerId: "official",
      upstreamId: "google-ai-studio",
      region: fixture.stub.region ?? "global",
      enabled: true,
      priority: -10_000,
      configuredCredentials: ["apiKey", "baseUrl"],
      credentials: {
        apiKey: "provider-traffic-replay-placeholder",
        baseUrl,
      },
    };
  };

  async function generateWithRoute(
    input: MockMediaGenerationInput,
    kind: ModelKind,
    fallback: () => Promise<MockMediaGenerationResult>,
    // Unfinished when a plugin hands the work to a provider that takes minutes and says so rather
    // than holding the call open.
  ): Promise<MockMediaGenerationResult> {
    const loadedProviderAccounts = loadProviderAccounts ? await loadProviderAccounts() : undefined;
    const environmentGoogleAccount = cloudflareGoogleEnvironmentAccount(options);
    const replayGoogleAccount = await googleAiStudioReplayAccount(input, kind);
    const additionalAccounts = [environmentGoogleAccount, replayGoogleAccount]
      .filter((account): account is RuntimeProviderAccountAvailability => !!account);
    const providerAccounts = additionalAccounts.length
      ? [...(loadedProviderAccounts ?? []), ...additionalAccounts]
      : loadedProviderAccounts;
    const modelCards = loadModelCards ? await loadModelCards() : undefined;
    const preferredProviderId = stringParam(input.modelParams, "provider_id");
    const requireRealProvider = input.modelParams?.require_real_provider === true;
    const explicitMockProvider = providerAccounts?.some(
      (account) => account.providerId === "mock" && account.enabled !== false,
    ) === true;
    const fallbackOrThrow = () => {
      if (requireRealProvider || (providerAccounts !== undefined && !explicitMockProvider)) {
        throw new Error(
          `${input.model} requires a configured real provider` +
          (preferredProviderId ? ` (${preferredProviderId})` : ""),
        );
      }
      return fallback();
    };
    const route = resolveLocalRoute(input.model, kind, providerAccounts, preferredProviderId, modelCards);
    if (!route || route.upstreamId === "mock") return fallbackOrThrow();
    const baseCard = (modelCards ?? MODEL_CARDS).find((card) => card.id === (normalizeModelId(input.model) ?? input.model));
    if (baseCard) {
      const effectiveCard = applyModelProviderImplementation(baseCard, route);
      const lyricsParam = effectiveCard.musicInput?.lyricsParam;
      // Only forward a duration the Card actually declares. Speech models take a
      // voice and a script; their length follows from the text, so a `duration` on the
      // request is not a shorter clip but an undeclared parameter, and the validator
      // rejected the whole generation for it.
      const cardTakesDuration = effectiveCard.parameters.some((parameter) => parameter.id === "duration")
        || effectiveCard.defaultParams.duration !== undefined;
      const durationParam = input.duration !== undefined && cardTakesDuration
        ? coerceModelParameterInput(effectiveCard, "duration", input.duration)
        : undefined;
      const effectiveModelParams: Record<string, string | number | boolean | undefined> = {
        ...(input.modelParams as Record<string, string | number | boolean | undefined> | undefined),
        ...(durationParam !== undefined ? { duration: durationParam } : {}),
        ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
      };
      const validationError = validateModelCardConfiguration(effectiveCard, {
        prompt: input.prompt,
        lyrics: lyricsParam && typeof effectiveModelParams[lyricsParam] === "string"
          ? effectiveModelParams[lyricsParam] as string
          : undefined,
        modelParams: effectiveModelParams,
      }, {
        rejectUnknownParameters: true,
        allowedParameterIds: [
          "aspect_ratio",
          "count",
          "height",
          "keyframe_frame_indices",
          "keyframe_timing_customized",
          "provider_id",
          "require_real_provider",
          "width",
          ...(lyricsParam ? [lyricsParam] : []),
        ],
      });
      if (validationError) throw new Error(validationError);
    }

    if (route.executorPluginId && route.executorExportId) {
      if (!options.providerPluginExecutor) {
        throw new ProviderPluginHostUnavailableError(
          `Provider executor ${route.executorPluginId}/${route.executorExportId} is unavailable.`,
        );
      }
      return generatePluginProviderMedia(input, kind, route, {
        fetch: fetchImpl,
        providerPluginExecutor: options.providerPluginExecutor,
      });
    }

    if (route.apiShape === "openai-images") {
      const apiKey = credential(route, providerAccounts, "apiKey");
      if (!apiKey) return fallbackOrThrow();
      return generateOpenAiImage(input, route, {
        fetch: fetchImpl,
        openAiBaseUrl: options.openAiBaseUrl,
      }, apiKey);
    }

    if (route.apiShape === "openai-compatible") {
      const apiKey = credential(route, providerAccounts, "apiKey");
      if (!apiKey) return fallbackOrThrow();
      const model = stringParam(input.modelParams, "model_name") || route.upstreamModel;
      const result = await generateTextCompletion({
        provider: "openai-compatible",
        apiKey,
        baseUrl: credential(route, providerAccounts, "baseUrl") || options.openAiBaseUrl,
        model,
        systemPrompt: stringParam(input.modelParams, "system_prompt"),
        messages: [{ role: "user", content: await orderedTextCompletionContent(input, fetchImpl) }],
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
      if (!apiKey) return fallbackOrThrow();
      const model = stringParam(input.modelParams, "model_name") || route.upstreamModel;
      const result = await generateTextCompletion({
        provider: "anthropic-compatible",
        apiKey,
        baseUrl: credential(route, providerAccounts, "baseUrl") || options.anthropicBaseUrl,
        model,
        systemPrompt: stringParam(input.modelParams, "system_prompt"),
        messages: [{ role: "user", content: await orderedTextCompletionContent(input, fetchImpl) }],
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

    if (route.apiShape === "google-ai-studio-interactions") {
      const gatewayToken = credential(route, providerAccounts, "gatewayToken")
        || options.googleAiStudioGatewayToken;
      const apiKey = gatewayToken
        ? undefined
        : credential(route, providerAccounts, "apiKey") || options.googleAiStudioApiKey;
      if (!apiKey && !gatewayToken) return fallbackOrThrow();
      if (kind !== "video") throw missingAdapter(route);
      const providerFetch = await providerFetchForRoute(route);
      return generateGeminiOmniVideo(input, route, {
        fetch: fetchImpl,
        providerFetch,
        googleAiStudioBaseUrl: credential(route, providerAccounts, "baseUrl") || options.googleAiStudioBaseUrl,
      }, { apiKey, gatewayToken });
    }

    if (route.apiShape === "google-ai-studio") {
      const apiKey = credential(route, providerAccounts, "apiKey");
      if (!apiKey) return fallbackOrThrow();
      return generateGoogleAiStudioMedia(input, kind, route, {
        fetch: fetchImpl,
        googleAiStudioBaseUrl: options.googleAiStudioBaseUrl,
      }, apiKey);
    }

    if (route.apiShape === "google-agent-platform") {
      const vertexCredentials = credential(route, providerAccounts, "vertexCredentials");
      if (!vertexCredentials) return fallbackOrThrow();
      if (kind === "text") return generateGoogleAgentPlatformText(input, route, fetchImpl, vertexCredentials);
      if (kind === "image") return generateGoogleAgentPlatformImage(input, route, fetchImpl, vertexCredentials);
      if (kind === "video") return generateGoogleAgentPlatformVideo(input, route, fetchImpl, vertexCredentials);
      throw missingAdapter(route);
    }

    if (route.apiShape === "fal") {
      const apiKey = credential(route, providerAccounts, "apiKey");
      if (!apiKey) return fallbackOrThrow();
      return generateFalMedia(input, kind, route, {
        fetch: fetchImpl,
        falQueueBaseUrl: options.falQueueBaseUrl,
        providerPluginProjector: options.providerPluginProjector,
      }, apiKey);
    }

    if (route.apiShape === "bfl") {
      const apiKey = credential(route, providerAccounts, "apiKey");
      if (!apiKey) return fallbackOrThrow();
      if (kind !== "video") throw missingAdapter(route);
      return generateBflVideoMedia(input, route, {
        fetch: fetchImpl,
        bflBaseUrl: options.bflBaseUrl,
      }, apiKey, credential(route, providerAccounts, "baseUrl"));
    }

    if (route.apiShape === "kie") {
      const apiKey = credential(route, providerAccounts, "apiKey");
      if (!apiKey) return fallbackOrThrow();
      return generateKieMedia(input, kind, route, {
        fetch: fetchImpl,
        kieBaseUrl: options.kieBaseUrl,
      }, apiKey);
    }

    if (route.apiShape === "pika") {
      const apiKey = credential(route, providerAccounts, "apiKey");
      if (!apiKey) return fallbackOrThrow();
      return generatePikaMedia(input, kind, route, {
        fetch: fetchImpl,
        pikaBaseUrl: options.pikaBaseUrl,
        providerUsageAudit: options.providerUsageAudit,
      }, apiKey);
    }

    if (route.apiShape === "pika-chat") {
      const apiKey = credential(route, providerAccounts, "apiKey");
      if (!apiKey) return fallbackOrThrow();
      if (kind !== "text") throw missingAdapter(route);
      let result;
      try {
        result = await generatePikaChat({
          apiKey,
          model: route.upstreamModel,
          prompt: input.prompt,
          systemPrompt: stringParam(input.modelParams, "system_prompt"),
          baseUrl: credential(route, providerAccounts, "baseUrl") || options.pikaBaseUrl,
          fetch: fetchImpl,
        });
        await options.providerUsageAudit?.({
          id: `${input.taskId}:pika:${result.requestId ?? "sync"}:completed`,
          userId: input.actorUserId ?? "local-user",
          providerId: "pika",
          ...(route.accountId ? { providerAccountId: route.accountId } : {}),
          modelId: route.modelCode,
          operation: route.upstreamModel,
          taskId: input.taskId,
          ...(input.projectId ? { projectId: input.projectId } : {}),
          ...(input.nodeId ? { nodeId: input.nodeId } : {}),
          actorType: input.actorType ?? "user",
          actorUserId: input.actorUserId ?? "local-user",
          ...(result.requestId ? { providerRequestId: result.requestId } : {}),
          idempotencyKey: input.taskId,
          status: "completed",
          estimateComplete: false,
          currency: "USD",
          pricingSource: "unavailable",
          billingBasis: result.usage ?? {},
          occurredAt: new Date().toISOString(),
        });
      } catch (error) {
        await options.providerUsageAudit?.({
          id: `${input.taskId}:pika:sync:failed`, userId: input.actorUserId ?? "local-user", providerId: "pika",
          modelId: route.modelCode, operation: route.upstreamModel, taskId: input.taskId, idempotencyKey: input.taskId,
          status: "failed", estimateComplete: false, currency: "USD", pricingSource: "unavailable", billingBasis: {},
          errorMessage: error instanceof Error ? error.message : String(error), occurredAt: new Date().toISOString(),
        });
        throw error;
      }
      return {
        bytes: new TextEncoder().encode(result.text),
        contentType: "text/plain; charset=utf-8",
        requestId: result.requestId ?? input.taskId,
        provider: "pika",
        modelEndpoint: route.upstreamModel,
      };
    }

    if (route.apiShape === "suno" && kind === "audio") {
      const apiKey = credential(route, providerAccounts, "apiKey");
      if (!apiKey) return fallbackOrThrow();
      return generateSunoMedia(input, route, {
        fetch: fetchImpl,
        sunoBaseUrl: options.sunoBaseUrl,
      }, apiKey, credential(route, providerAccounts, "callbackUrl"));
    }

    if (route.apiShape === "minimax" && (kind === "audio" || kind === "video")) {
      const apiKey = credential(route, providerAccounts, "apiKey");
      if (!apiKey) return fallbackOrThrow();
      return generateMiniMaxMedia(input, kind, route, {
        fetch: fetchImpl,
        minimaxBaseUrl: options.minimaxBaseUrl,
      }, apiKey, credential(route, providerAccounts, "baseUrl"));
    }

    if (route.apiShape === "replicate") {
      const apiKey = credential(route, providerAccounts, "apiKey");
      if (!apiKey) return fallbackOrThrow();
      return generateReplicateMedia(input, kind, route, {
        fetch: fetchImpl,
        replicateBaseUrl: options.replicateBaseUrl,
      }, apiKey);
    }

    if (route.apiShape === "local-tts" && kind === "audio") {
      if (!options.localTts) throw missingAdapter(route);
      return options.localTts({
        ...input,
        model: route.upstreamModel,
      });
    }

    if (route.apiShape === "dreamina-cli" && kind === "video") {
      const result = await generateDreaminaCliVideoMedia({
        prompt: promptForRoute(input, route),
        modelName: input.model,
        upstreamModel: route.upstreamModel,
        duration: input.duration,
        aspectRatio: input.aspectRatio,
        resolution: stringParam(input.modelParams ?? {}, "resolution"),
        startFrameUrl: input.startFrameUrl,
        endFrameUrl: input.endFrameUrl,
        referenceImageUrls: input.referenceImageUrls,
        referenceVideoUrls: input.referenceVideoUrls,
        referenceAudioUrls: input.referenceAudioUrls,
        fetch: fetchImpl,
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
          aspect_ratio: input.aspectRatio,
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
      const textFallback = async () => ({
        bytes: new TextEncoder().encode(`Generated text (${input.model})\n\n${input.prompt || "Mock text"}`),
        contentType: "text/plain; charset=utf-8",
        requestId: input.taskId,
        provider: "mock",
        modelEndpoint: resolveMockFalModelId(input.model, "text", "mock-text"),
      });
      // `MockTextGenerationResult` has no unfinished arm -- a caller asking for text has nowhere to
      // put an acceptance -- so poll it out here.
      const result = await settleAcceptedGeneration(
        await generateWithRoute(input, "text", textFallback),
        (pollState) => generateWithRoute({ ...input, pollState }, "text", textFallback),
      );
      return {
        text: new TextDecoder().decode(result.bytes),
        provider: result.provider,
        modelEndpoint: result.modelEndpoint,
      };
    },
  };
}
