import { z } from "zod";

import type { ModelKind } from "./models";

export const ModelUpstreamIdSchema = z.enum([
  "mock",
  "fal",
  "google",
  "openai",
  "openrouter",
  "replicate",
  "kie",
]);
export type ModelUpstreamId = z.infer<typeof ModelUpstreamIdSchema>;

export const ModelUpstreamApiShapeSchema = z.enum([
  "fal",
  "google-vertex",
  "google-ai-studio",
  "openai-images",
  "openai-compatible",
  "replicate",
  "kie",
]);
export type ModelUpstreamApiShape = z.infer<typeof ModelUpstreamApiShapeSchema>;

export interface ModelUpstreamRoute {
  /** Public model code stored by the app, e.g. "seedance-2-ref". */
  modelCode: string;
  kind: ModelKind;
  upstreamId: ModelUpstreamId;
  /** Upstream-native model/endpoint string. */
  upstreamModel: string;
  /** Wire protocol shape this adapter exposes. Mock intentionally keeps fal shape. */
  apiShape: ModelUpstreamApiShape;
  /** Lower numbers win unless user provider order overrides them. */
  priority: number;
  requiredVariables?: string[];
}

export interface UpstreamAvailability {
  upstreamId: ModelUpstreamId;
  enabled?: boolean;
  /**
   * Omit when key availability is unknown and should be checked by the adapter.
   * Pass [] to explicitly indicate BYOK is missing.
   */
  availableVariables?: string[];
  /** Lower numbers win within this upstream. */
  priority?: number;
}

export interface ModelUpstreamRouteQuery {
  modelCode: string;
  kind?: ModelKind;
  configuredUpstreams?: UpstreamAvailability[];
  allowMock?: boolean;
}

export const ModelProviderIdSchema = ModelUpstreamIdSchema;
export const ModelProviderApiShapeSchema = ModelUpstreamApiShapeSchema;
export type ModelProviderId = ModelUpstreamId;
export type ModelProviderApiShape = ModelUpstreamApiShape;
export type ModelProviderRoute = ModelUpstreamRoute;
export type ProviderAvailability = UpstreamAvailability;
export type ModelProviderRouteQuery = ModelUpstreamRouteQuery;

const FAL_SECRET = "FAL_API_KEY";
const GOOGLE_VERTEX_SECRET = "GOOGLE_VERTEX";
const GOOGLE_AI_STUDIO_SECRET = "GOOGLE_API_KEY";
const OPENAI_SECRET = "OPENAI_API_KEY";

function fal(
  modelCode: string,
  kind: ModelKind,
  upstreamModel: string,
  priority = 20,
): ModelProviderRoute {
  return {
    modelCode,
    kind,
    upstreamId: "fal",
    upstreamModel,
    apiShape: "fal",
    priority,
    requiredVariables: [FAL_SECRET],
  };
}

function falMock(
  modelCode: string,
  kind: ModelKind,
  upstreamModel: string,
): ModelProviderRoute {
  return {
    modelCode,
    kind,
    upstreamId: "mock",
    upstreamModel,
    apiShape: "fal",
    priority: 1,
  };
}

function googleVertex(
  modelCode: string,
  kind: ModelKind,
  upstreamModel: string,
  priority = 10,
): ModelProviderRoute {
  return {
    modelCode,
    kind,
    upstreamId: "google",
    upstreamModel,
    apiShape: "google-vertex",
    priority,
    requiredVariables: [GOOGLE_VERTEX_SECRET],
  };
}

function googleAiStudio(
  modelCode: string,
  kind: ModelKind,
  upstreamModel: string,
  priority = 10,
): ModelProviderRoute {
  return {
    modelCode,
    kind,
    upstreamId: "google",
    upstreamModel,
    apiShape: "google-ai-studio",
    priority,
    requiredVariables: [GOOGLE_AI_STUDIO_SECRET],
  };
}

function openAiCompatible(
  modelCode: string,
  upstreamModel: string,
  priority = 10,
): ModelProviderRoute {
  return {
    modelCode,
    kind: "text",
    upstreamId: "openai",
    upstreamModel,
    apiShape: "openai-compatible",
    priority,
    requiredVariables: [OPENAI_SECRET],
  };
}

function openAiImages(
  modelCode: string,
  upstreamModel: string,
  priority = 10,
): ModelProviderRoute {
  return {
    modelCode,
    kind: "image",
    upstreamId: "openai",
    upstreamModel,
    apiShape: "openai-images",
    priority,
    requiredVariables: [OPENAI_SECRET],
  };
}

const FAL_IMAGE_ROUTES: Array<[string, string]> = [
  ["flux-schnell", "fal-ai/flux/schnell"],
  ["flux-dev", "fal-ai/flux/dev"],
  ["nano-banana-2", "fal-ai/nano-banana-2"],
  ["nano-banana-2-edit", "fal-ai/nano-banana-2/edit"],
  ["recraft-v4", "fal-ai/recraft/v4/pro/text-to-image"],
  ["flux-2-pro", "fal-ai/flux-2-pro"],
  ["flux-2-pro-edit", "fal-ai/flux-2-pro/edit"],
];

const FAL_VIDEO_ROUTES: Array<[string, string]> = [
  ["sora-2", "fal-ai/sora-2/text-to-video"],
  ["kling-2.1", "fal-ai/kling-video/v2.1/standard/text-to-video"],
  ["kling-3", "fal-ai/kling-video/v3/pro/image-to-video"],
  ["veo3", "fal-ai/veo3"],
  ["veo3-fast-text-to-video", "fal-ai/veo3/fast"],
  ["seedance-2-text", "bytedance/seedance-2.0/text-to-video"],
  ["seedance-2-startend", "bytedance/seedance-2.0/image-to-video"],
  ["seedance-2-ref", "bytedance/seedance-2.0/reference-to-video"],
];

const GOOGLE_IMAGE_ROUTES: Array<[string, string]> = [
  ["gemini-flash-image", "gemini-2.5-flash-image"],
  ["gemini-flash-image-2", "gemini-3.1-flash-image-preview"],
  ["gemini-pro-image", "gemini-3-pro-image-preview"],
];

const GOOGLE_VIDEO_ROUTES: Array<[string, string]> = [
  ["veo-3.1", "veo-3.1-generate-001"],
  ["veo-3.1-startend", "veo-3.1-generate-001"],
  ["veo-3.1-lite", "veo-3.1-lite-generate-001"],
  ["veo-3.1-fast", "veo-3.1-fast-generate-001"],
  ["veo-3.1-fast-startend", "veo-3.1-fast-generate-001"],
];

const GOOGLE_AUDIO_ROUTES: Array<[string, string]> = [
  ["gemini-3.1-flash-tts", "gemini-3.1-flash-tts-preview"],
  ["gemini-2.5-flash-tts", "gemini-2.5-flash-tts"],
  ["gemini-2.5-pro-tts", "gemini-2.5-pro-tts"],
];

const GOOGLE_TEXT_ROUTES: Array<[string, string]> = [
  ["gemini-3.1-pro", "gemini-3.1-pro-preview"],
  ["gemini-3-flash", "gemini-3-flash-preview"],
];

export const MODEL_UPSTREAM_ROUTES: ModelUpstreamRoute[] = [
  ...FAL_IMAGE_ROUTES.flatMap(([modelCode, upstreamModel]) => [
    fal(modelCode, "image", upstreamModel),
    falMock(modelCode, "image", upstreamModel),
  ]),
  ...FAL_VIDEO_ROUTES.flatMap(([modelCode, upstreamModel]) => [
    fal(modelCode, "video", upstreamModel),
    falMock(modelCode, "video", upstreamModel),
  ]),
  ...GOOGLE_IMAGE_ROUTES.flatMap(([modelCode, upstreamModel]) => [
    googleVertex(modelCode, "image", upstreamModel),
    fal(modelCode, "image", "fal-ai/nano-banana-2", 30),
    falMock(modelCode, "image", "fal-ai/nano-banana-2"),
  ]),
  ...GOOGLE_VIDEO_ROUTES.flatMap(([modelCode, upstreamModel]) => [
    googleVertex(modelCode, "video", upstreamModel),
    falMock(modelCode, "video", modelCode.includes("fast") ? "fal-ai/veo3/fast" : "fal-ai/veo3"),
  ]),
  ...GOOGLE_AUDIO_ROUTES.flatMap(([modelCode, upstreamModel]) => [
    googleAiStudio(modelCode, "audio", upstreamModel),
    falMock(modelCode, "audio", "fal-ai/minimax/speech-02-hd"),
  ]),
  ...GOOGLE_TEXT_ROUTES.map(([modelCode, upstreamModel]) =>
    googleVertex(modelCode, "text", upstreamModel),
  ),
  openAiImages("gpt-image-2", "gpt-image-2"),
  falMock("gpt-image-2", "image", "fal-ai/nano-banana-2"),
  openAiCompatible("gpt-5.4", "gpt-5.4"),
  falMock("minimax-tts", "audio", "fal-ai/minimax/speech-02-hd"),
  falMock("elevenlabs-tts", "audio", "fal-ai/minimax/speech-02-hd"),
];

export const MODEL_PROVIDER_ROUTES = MODEL_UPSTREAM_ROUTES;

function directFalRoute(query: ModelUpstreamRouteQuery): ModelUpstreamRoute | null {
  if (!query.modelCode.startsWith("fal-ai/") && !query.modelCode.startsWith("bytedance/")) {
    return null;
  }
  return {
    modelCode: query.modelCode,
    kind: query.kind ?? "image",
    upstreamId: query.allowMock ? "mock" : "fal",
    upstreamModel: query.modelCode,
    apiShape: "fal",
    priority: 50,
    requiredVariables: query.allowMock ? undefined : [FAL_SECRET],
  };
}

function upstreamIndex(configuredUpstreams: UpstreamAvailability[] | undefined, upstreamId: ModelUpstreamId): number {
  if (!configuredUpstreams) return Number.POSITIVE_INFINITY;
  const index = configuredUpstreams.findIndex((upstream) => upstream.upstreamId === upstreamId);
  return index >= 0 ? index : Number.POSITIVE_INFINITY;
}

function upstreamConfig(
  configuredUpstreams: UpstreamAvailability[] | undefined,
  upstreamId: ModelUpstreamId,
): UpstreamAvailability | undefined {
  return configuredUpstreams?.find((upstream) => upstream.upstreamId === upstreamId);
}

function hasRequiredVariables(route: ModelUpstreamRoute, config: UpstreamAvailability | undefined): boolean {
  if (!route.requiredVariables?.length) return true;
  if (!config || config.availableVariables === undefined) return true;
  return route.requiredVariables.every((variable) => config.availableVariables?.includes(variable));
}

function isEnabled(route: ModelUpstreamRoute, query: ModelUpstreamRouteQuery): boolean {
  if (route.upstreamId === "mock" && !query.allowMock) return false;
  if (!query.configuredUpstreams) return true;
  const config = upstreamConfig(query.configuredUpstreams, route.upstreamId);
  if (!config || config.enabled === false) return false;
  return hasRequiredVariables(route, config);
}

export function listModelUpstreamRoutes(query: ModelUpstreamRouteQuery): ModelUpstreamRoute[] {
  const direct = directFalRoute(query);
  const candidates = direct
    ? [direct]
    : MODEL_UPSTREAM_ROUTES.filter(
        (route) =>
          route.modelCode === query.modelCode &&
          (!query.kind || route.kind === query.kind),
      );

  return candidates
    .filter((route) => isEnabled(route, query))
    .sort((a, b) => {
      const aConfig = upstreamConfig(query.configuredUpstreams, a.upstreamId);
      const bConfig = upstreamConfig(query.configuredUpstreams, b.upstreamId);
      const aIndex = upstreamIndex(query.configuredUpstreams, a.upstreamId);
      const bIndex = upstreamIndex(query.configuredUpstreams, b.upstreamId);
      if (aIndex !== bIndex) return aIndex - bIndex;
      const aUpstreamPriority = aConfig?.priority ?? 0;
      const bUpstreamPriority = bConfig?.priority ?? 0;
      if (aUpstreamPriority !== bUpstreamPriority) return aUpstreamPriority - bUpstreamPriority;
      return a.priority - b.priority;
    });
}

export function resolveModelUpstreamRoute(query: ModelUpstreamRouteQuery): ModelUpstreamRoute | null {
  return listModelUpstreamRoutes(query)[0] ?? null;
}

export const listModelProviderRoutes = listModelUpstreamRoutes;
export const resolveModelProviderRoute = resolveModelUpstreamRoute;
