import { z } from "zod";

import { MODEL_CARDS, type ModelCard, type ModelKind } from "./models";

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

export const ProviderAccountIdSchema = z.enum([
  "official",
  "fal",
  "kie",
  "replicate",
  "mock",
  "custom",
]);
export type ProviderAccountId = z.infer<typeof ProviderAccountIdSchema>;

export interface ModelUpstreamRoute {
  /** Public model code stored by the app, e.g. "seedance-2-ref". */
  modelCode: string;
  kind: ModelKind;
  /** User-facing account bucket. `official` can still route to OpenAI/Google/etc. adapters. */
  providerId?: ProviderAccountId;
  /** Optional account region/channel, e.g. official global vs domestic. */
  region?: "global" | "cn" | string;
  upstreamId: ModelUpstreamId;
  /** Upstream-native model/endpoint string. */
  upstreamModel: string;
  /** Wire protocol shape this adapter exposes. Mock intentionally keeps fal shape. */
  apiShape: ModelUpstreamApiShape;
  /** Lower numbers win unless user provider order overrides them. */
  priority: number;
  /** Higher numbers win when user/provider route weighting is configured. */
  weight?: number;
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
  /** Higher numbers win before provider order when set. */
  weight?: number;
}

export interface ProviderAccountAvailability {
  providerId: ProviderAccountId;
  upstreamId?: ModelUpstreamId;
  region?: string;
  enabled?: boolean;
  /**
   * Omit when key availability is unknown and should be checked by the adapter.
   * Pass [] to explicitly indicate BYOK is missing.
   */
  availableVariables?: string[];
  /** Lower numbers win within equal weights. */
  priority?: number;
  /** Higher numbers win before declaration order. */
  weight?: number;
}

export interface ModelUpstreamRouteQuery {
  modelCode: string;
  kind?: ModelKind;
  configuredUpstreams?: UpstreamAvailability[];
  configuredProviders?: ProviderAccountAvailability[];
  allowMock?: boolean;
}

export const ModelProviderIdSchema = ModelUpstreamIdSchema;
export const ModelProviderApiShapeSchema = ModelUpstreamApiShapeSchema;
export type ModelProviderId = ModelUpstreamId;
export type ModelProviderApiShape = ModelUpstreamApiShape;
export type ModelProviderRoute = ModelUpstreamRoute;
export type ProviderAvailability = UpstreamAvailability;
export type ModelProviderRouteQuery = ModelUpstreamRouteQuery;
export type ModelCatalogTier = "available" | "configured-provider" | "all";

export interface ModelCatalogEntry {
  model: ModelCard;
  tier: ModelCatalogTier;
  routes: ModelUpstreamRoute[];
  selectedRoute: ModelUpstreamRoute | null;
  candidateProviders: ProviderAccountId[];
  missingVariables: string[];
}

const FAL_SECRET = "FAL_API_KEY";
const GOOGLE_VERTEX_SECRET = "GOOGLE_VERTEX";
const GOOGLE_AI_STUDIO_SECRET = "GOOGLE_API_KEY";
const OPENAI_SECRET = "OPENAI_API_KEY";
const KIE_SECRET = "KIE_API_KEY";
const REPLICATE_SECRET = "REPLICATE_API_TOKEN";

function fal(
  modelCode: string,
  kind: ModelKind,
  upstreamModel: string,
  priority = 20,
): ModelProviderRoute {
  return {
    modelCode,
    kind,
    providerId: "fal",
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
    providerId: "mock",
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
    providerId: "official",
    region: "global",
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
    providerId: "official",
    region: "global",
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
    providerId: "official",
    region: "global",
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
    providerId: "official",
    region: "global",
    upstreamId: "openai",
    upstreamModel,
    apiShape: "openai-images",
    priority,
    requiredVariables: [OPENAI_SECRET],
  };
}

function kie(
  modelCode: string,
  kind: ModelKind,
  upstreamModel: string,
  priority = 25,
): ModelProviderRoute {
  return {
    modelCode,
    kind,
    providerId: "kie",
    upstreamId: "kie",
    upstreamModel,
    apiShape: "kie",
    priority,
    requiredVariables: [KIE_SECRET],
  };
}

function replicate(
  modelCode: string,
  kind: ModelKind,
  upstreamModel: string,
  priority = 25,
): ModelProviderRoute {
  return {
    modelCode,
    kind,
    providerId: "replicate",
    upstreamId: "replicate",
    upstreamModel,
    apiShape: "replicate",
    priority,
    requiredVariables: [REPLICATE_SECRET],
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

const GOOGLE_AI_STUDIO_IMAGE_ROUTES: Array<[string, string]> = [
  ["gemini-flash-image", "gemini-2.5-flash-image"],
  ["gemini-flash-image-2", "gemini-3.1-flash-image"],
  ["gemini-pro-image", "gemini-3-pro-image"],
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

const KIE_IMAGE_ROUTES: Array<[string, string]> = [
  ["nano-banana-2", "nano-banana-2"],
  ["gpt-image-2", "gpt-image-2-text-to-image"],
  ["flux-schnell", "flux-2/flex-text-to-image"],
  ["flux-dev", "flux-2/flex-text-to-image"],
  ["flux-2-pro", "flux-2/pro-text-to-image"],
];

const KIE_VIDEO_ROUTES: Array<[string, string]> = [
  ["seedance-2-text", "bytedance/seedance-2"],
  ["seedance-2-startend", "bytedance/seedance-2"],
  ["seedance-2-ref", "bytedance/seedance-2"],
  ["kling-2.1", "kling/v2-1-standard"],
  ["kling-3", "kling-3.0/video"],
];

const REPLICATE_IMAGE_ROUTES: Array<[string, string]> = [
  ["nano-banana-2", "google/nano-banana-2"],
  ["gpt-image-2", "openai/gpt-image-2"],
  ["flux-schnell", "black-forest-labs/flux-schnell"],
];

const REPLICATE_VIDEO_ROUTES: Array<[string, string]> = [
  ["seedance-2-text", "bytedance/seedance-2.0"],
  ["seedance-2-startend", "bytedance/seedance-2.0"],
  ["seedance-2-ref", "bytedance/seedance-2.0"],
];

export const MODEL_UPSTREAM_ROUTES: ModelUpstreamRoute[] = [
  ...FAL_IMAGE_ROUTES.flatMap(([modelCode, upstreamModel]) => [
    fal(modelCode, "image", upstreamModel),
    falMock(modelCode, "image", upstreamModel),
  ]),
  ...KIE_IMAGE_ROUTES.map(([modelCode, upstreamModel]) => kie(modelCode, "image", upstreamModel)),
  ...REPLICATE_IMAGE_ROUTES.map(([modelCode, upstreamModel]) => replicate(modelCode, "image", upstreamModel)),
  ...FAL_VIDEO_ROUTES.flatMap(([modelCode, upstreamModel]) => [
    fal(modelCode, "video", upstreamModel),
    falMock(modelCode, "video", upstreamModel),
  ]),
  ...KIE_VIDEO_ROUTES.map(([modelCode, upstreamModel]) => kie(modelCode, "video", upstreamModel)),
  ...REPLICATE_VIDEO_ROUTES.map(([modelCode, upstreamModel]) => replicate(modelCode, "video", upstreamModel)),
  ...GOOGLE_IMAGE_ROUTES.flatMap(([modelCode, upstreamModel]) => [
    googleAiStudio(
      modelCode,
      "image",
      GOOGLE_AI_STUDIO_IMAGE_ROUTES.find(([candidate]) => candidate === modelCode)?.[1] ?? upstreamModel,
      12,
    ),
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
    fal(modelCode, "audio", "fal-ai/minimax/speech-02-hd", 30),
    falMock(modelCode, "audio", "fal-ai/minimax/speech-02-hd"),
  ]),
  ...GOOGLE_TEXT_ROUTES.map(([modelCode, upstreamModel]) =>
    googleVertex(modelCode, "text", upstreamModel),
  ),
  openAiImages("gpt-image-2", "gpt-image-2"),
  falMock("gpt-image-2", "image", "fal-ai/nano-banana-2"),
  openAiCompatible("gpt-5.4", "gpt-5.4"),
  fal("minimax-tts", "audio", "fal-ai/minimax/speech-02-hd"),
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
    providerId: query.allowMock ? "mock" : "fal",
    upstreamId: query.allowMock ? "mock" : "fal",
    upstreamModel: query.modelCode,
    apiShape: "fal",
    priority: 50,
    requiredVariables: query.allowMock ? undefined : [FAL_SECRET],
  };
}

function providerIdForRoute(route: ModelUpstreamRoute): ProviderAccountId {
  if (route.providerId) return route.providerId;
  if (route.upstreamId === "openai" || route.upstreamId === "google") return "official";
  if (route.upstreamId === "fal" || route.upstreamId === "kie" || route.upstreamId === "replicate" || route.upstreamId === "mock") {
    return route.upstreamId;
  }
  return "custom";
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

function providerIndex(configuredProviders: ProviderAccountAvailability[] | undefined, route: ModelUpstreamRoute): number {
  if (!configuredProviders) return Number.POSITIVE_INFINITY;
  const index = configuredProviders.findIndex((provider) => matchesProviderAccount(route, provider));
  return index >= 0 ? index : Number.POSITIVE_INFINITY;
}

function matchesProviderAccount(route: ModelUpstreamRoute, provider: ProviderAccountAvailability): boolean {
  if (provider.providerId !== providerIdForRoute(route)) return false;
  if (provider.upstreamId && provider.upstreamId !== route.upstreamId) return false;
  if (provider.region && route.region && provider.region !== route.region) return false;
  return true;
}

function providerConfig(
  configuredProviders: ProviderAccountAvailability[] | undefined,
  route: ModelUpstreamRoute,
): ProviderAccountAvailability | undefined {
  return configuredProviders?.find((provider) => matchesProviderAccount(route, provider));
}

function configForRoute(
  query: Pick<ModelUpstreamRouteQuery, "configuredProviders" | "configuredUpstreams">,
  route: ModelUpstreamRoute,
): ProviderAccountAvailability | UpstreamAvailability | undefined {
  if (query.configuredProviders) return providerConfig(query.configuredProviders, route);
  return upstreamConfig(query.configuredUpstreams, route.upstreamId);
}

function missingRequiredVariables(
  route: ModelUpstreamRoute,
  config: ProviderAccountAvailability | UpstreamAvailability | undefined,
): string[] {
  if (!route.requiredVariables?.length) return [];
  if (!config || config.availableVariables === undefined) return [];
  return route.requiredVariables.filter((variable) => !config.availableVariables?.includes(variable));
}

function hasRequiredVariables(
  route: ModelUpstreamRoute,
  config: ProviderAccountAvailability | UpstreamAvailability | undefined,
): boolean {
  if (!route.requiredVariables?.length) return true;
  if (!config || config.availableVariables === undefined) return true;
  return missingRequiredVariables(route, config).length === 0;
}

function isEnabled(route: ModelUpstreamRoute, query: ModelUpstreamRouteQuery): boolean {
  if (route.upstreamId === "mock" && !query.allowMock) return false;
  if (!query.configuredUpstreams && !query.configuredProviders) return true;
  const config = configForRoute(query, route);
  if (!config || config.enabled === false) return false;
  return hasRequiredVariables(route, config);
}

function candidateRoutes(query: ModelUpstreamRouteQuery): ModelUpstreamRoute[] {
  const direct = directFalRoute(query);
  return direct
    ? [direct]
    : MODEL_UPSTREAM_ROUTES.filter(
        (route) =>
          route.modelCode === query.modelCode &&
          (!query.kind || route.kind === query.kind),
      );
}

export function listModelUpstreamRoutes(query: ModelUpstreamRouteQuery): ModelUpstreamRoute[] {
  const candidates = candidateRoutes(query);

  return candidates
    .filter((route) => isEnabled(route, query))
    .sort((a, b) => {
      const aConfig = configForRoute(query, a);
      const bConfig = configForRoute(query, b);
      const aWeight = (aConfig?.weight ?? 0) + (a.weight ?? 0);
      const bWeight = (bConfig?.weight ?? 0) + (b.weight ?? 0);
      if (aWeight !== bWeight) return bWeight - aWeight;
      const aIndex = query.configuredProviders
        ? providerIndex(query.configuredProviders, a)
        : upstreamIndex(query.configuredUpstreams, a.upstreamId);
      const bIndex = query.configuredProviders
        ? providerIndex(query.configuredProviders, b)
        : upstreamIndex(query.configuredUpstreams, b.upstreamId);
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

function uniqueProviderIds(routes: ModelUpstreamRoute[]): ProviderAccountId[] {
  return [...new Set(routes.map(providerIdForRoute))];
}

export function listModelCatalogEntries(options: {
  models?: readonly ModelCard[];
  configuredProviders?: ProviderAccountAvailability[];
  configuredUpstreams?: UpstreamAvailability[];
  allowMock?: boolean;
} = {}): ModelCatalogEntry[] {
  const models = options.models ?? MODEL_CARDS;
  return models.map((model) => {
    const query: ModelUpstreamRouteQuery = {
      modelCode: model.id,
      kind: model.kind,
      configuredProviders: options.configuredProviders,
      configuredUpstreams: options.configuredUpstreams,
      allowMock: options.allowMock,
    };
    const allRoutes = candidateRoutes({ modelCode: model.id, kind: model.kind, allowMock: options.allowMock });
    const routes = listModelUpstreamRoutes(query);
    const selectedRoute = routes[0] ?? null;
    const configuredCandidates = allRoutes.filter((route) => {
      const config = configForRoute(query, route);
      return !!config && config.enabled !== false;
    });
    const missingVariables = [
      ...new Set(configuredCandidates.flatMap((route) => missingRequiredVariables(route, configForRoute(query, route)))),
    ];
    const tier: ModelCatalogTier = selectedRoute
      ? "available"
      : configuredCandidates.length > 0
        ? "configured-provider"
        : "all";
    return {
      model,
      tier,
      routes,
      selectedRoute,
      candidateProviders: uniqueProviderIds(configuredCandidates.length ? configuredCandidates : allRoutes),
      missingVariables,
    };
  });
}

export const listModelProviderRoutes = listModelUpstreamRoutes;
export const resolveModelProviderRoute = resolveModelUpstreamRoute;
