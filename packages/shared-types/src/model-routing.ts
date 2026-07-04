import { z } from "zod";

import { MOCK_MODEL_CARDS, MODEL_CARDS, type ModelCard, type ModelKind } from "./models";

export const ModelUpstreamIdSchema = z.enum([
  "local",
  "mock",
  "fal",
  "google-ai-studio",
  "google-agent-platform",
  "openai",
  "anthropic",
  "openrouter",
  "replicate",
  "kie",
  "kling",
  "minimax",
  "jimeng",
  "volcengine",
  "elevenlabs",
]);
export type ModelUpstreamId = z.infer<typeof ModelUpstreamIdSchema>;

export const ModelUpstreamApiShapeSchema = z.enum([
  "local-asr",
  "fal",
  "google-agent-platform",
  "google-ai-studio",
  "openai-images",
  "openai-compatible",
  "anthropic-compatible",
  "replicate",
  "kie",
  "kling",
  "minimax",
  "modelark",
  "dreamina-cli",
  "elevenlabs",
]);
export type ModelUpstreamApiShape = z.infer<typeof ModelUpstreamApiShapeSchema>;

export const ProviderOAuthIdSchema = z.enum([
  "dreamina",
]);
export type ProviderOAuthId = z.infer<typeof ProviderOAuthIdSchema>;

export const ProviderAccountIdSchema = z.enum([
  "local",
  "official",
  "fal",
  "kie",
  "replicate",
  "kling",
  "minimax",
  "jimeng",
  "volcengine",
  "elevenlabs",
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
  requiredCredentials?: string[];
  requiredOAuth?: ProviderOAuthId[];
}

export interface ModelProviderSupportedModel {
  modelCode: string;
  kind: ModelKind;
  upstreamModel: string;
  priority?: number;
  weight?: number;
}

export interface ModelProviderDefinition {
  providerId: ProviderAccountId;
  upstreamId: ModelUpstreamId;
  region?: "global" | "cn" | string;
  apiShape: ModelUpstreamApiShape;
  priority: number;
  weight?: number;
  requiredCredentials?: string[];
  requiredOAuth?: ProviderOAuthId[];
}

export interface UpstreamAvailability {
  upstreamId: ModelUpstreamId;
  enabled?: boolean;
  configuredCredentials?: string[];
  availableOAuth?: ProviderOAuthId[];
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
  configuredCredentials?: string[];
  availableOAuth?: ProviderOAuthId[];
  /** When set, this account only serves the listed public model card ids. Undefined means all models declared by the provider. */
  supportedModelIds?: string[];
  /** Lower numbers win for a specific public model card id. */
  modelPriorities?: Record<string, number>;
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
  missingCredentials: string[];
  missingOAuth: ProviderOAuthId[];
}

const API_KEY_CREDENTIAL = "apiKey";
const BASE_URL_CREDENTIAL = "baseUrl";
const ACCESS_KEY_CREDENTIAL = "accessKey";
const SECRET_KEY_CREDENTIAL = "secretKey";
const VERTEX_CREDENTIAL = "vertexCredentials";
const DREAMINA_OAUTH = "dreamina";

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
  ["kling-3", "fal-ai/kling-video/v3/pro/image-to-video"],
  ["seedance-2-text", "bytedance/seedance-2.0/text-to-video"],
  ["seedance-2-startend", "bytedance/seedance-2.0/image-to-video"],
  ["seedance-2-ref", "bytedance/seedance-2.0/reference-to-video"],
];

const GOOGLE_IMAGE_ROUTES: Array<[string, string]> = [
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
  ["gemini-2.5-pro-tts", "gemini-2.5-pro-tts"],
];

function routesFromModelCard(model: ModelCard): ModelUpstreamRoute[] {
  return (model.providerImplementations ?? []).map((implementation) => ({
    modelCode: model.id,
    kind: model.kind,
    providerId: implementation.providerId,
    ...(implementation.region ? { region: implementation.region } : {}),
    upstreamId: ModelUpstreamIdSchema.parse(implementation.upstreamId),
    upstreamModel: implementation.upstreamModel,
    apiShape: ModelUpstreamApiShapeSchema.parse(implementation.apiShape),
    priority: implementation.priority ?? 100,
    ...(implementation.weight !== undefined ? { weight: implementation.weight } : {}),
    ...(implementation.requiredCredentials?.length ? { requiredCredentials: [...implementation.requiredCredentials] } : {}),
    ...(implementation.requiredOAuth?.length
      ? { requiredOAuth: implementation.requiredOAuth.map((provider) => ProviderOAuthIdSchema.parse(provider)) }
      : {}),
  }));
}

function routesFromModelCards(models: readonly ModelCard[]): ModelUpstreamRoute[] {
  return models.flatMap(routesFromModelCard);
}

export const MODEL_PROVIDER_DEFINITIONS: ModelProviderDefinition[] = [
  {
    providerId: "local",
    upstreamId: "local",
    apiShape: "local-asr",
    priority: 1,
  },
  {
    providerId: "fal",
    upstreamId: "fal",
    apiShape: "fal",
    priority: 20,
    requiredCredentials: [API_KEY_CREDENTIAL],
  },
  {
    providerId: "kie",
    upstreamId: "kie",
    apiShape: "kie",
    priority: 25,
    requiredCredentials: [API_KEY_CREDENTIAL],
  },
  {
    providerId: "replicate",
    upstreamId: "replicate",
    apiShape: "replicate",
    priority: 25,
    requiredCredentials: [API_KEY_CREDENTIAL],
  },
  {
    providerId: "official",
    upstreamId: "google-ai-studio",
    region: "global",
    apiShape: "google-ai-studio",
    priority: 10,
    requiredCredentials: [API_KEY_CREDENTIAL],
  },
  {
    providerId: "official",
    upstreamId: "google-agent-platform",
    region: "global",
    apiShape: "google-agent-platform",
    priority: 10,
    requiredCredentials: [VERTEX_CREDENTIAL],
  },
  {
    providerId: "official",
    upstreamId: "openai",
    region: "global",
    apiShape: "openai-images",
    priority: 10,
    requiredCredentials: [API_KEY_CREDENTIAL],
  },
  {
    providerId: "official",
    upstreamId: "openai",
    region: "global",
    apiShape: "openai-compatible",
    priority: 10,
    requiredCredentials: [API_KEY_CREDENTIAL],
  },
  {
    providerId: "official",
    upstreamId: "anthropic",
    region: "global",
    apiShape: "anthropic-compatible",
    priority: 10,
    requiredCredentials: [API_KEY_CREDENTIAL],
  },
  {
    providerId: "kling",
    upstreamId: "kling",
    apiShape: "kling",
    priority: 8,
    requiredCredentials: [ACCESS_KEY_CREDENTIAL, SECRET_KEY_CREDENTIAL],
  },
  {
    providerId: "jimeng",
    upstreamId: "jimeng",
    apiShape: "dreamina-cli",
    priority: 8,
    requiredOAuth: [DREAMINA_OAUTH],
  },
  {
    providerId: "volcengine",
    upstreamId: "volcengine",
    apiShape: "modelark",
    priority: 9,
    requiredCredentials: [API_KEY_CREDENTIAL],
  },
  {
    providerId: "minimax",
    upstreamId: "minimax",
    apiShape: "minimax",
    priority: 8,
    requiredCredentials: [API_KEY_CREDENTIAL],
  },
  {
    providerId: "elevenlabs",
    upstreamId: "elevenlabs",
    apiShape: "elevenlabs",
    priority: 8,
    requiredCredentials: [API_KEY_CREDENTIAL],
  },
];

const MODEL_DECLARED_ROUTES = routesFromModelCards(MODEL_CARDS);
const MOCK_DECLARED_ROUTES = routesFromModelCards(MOCK_MODEL_CARDS);

const MOCK_ROUTES: ModelUpstreamRoute[] = [
  ...FAL_IMAGE_ROUTES.map(([modelCode, upstreamModel]) => falMock(modelCode, "image", upstreamModel)),
  ...FAL_VIDEO_ROUTES.map(([modelCode, upstreamModel]) => falMock(modelCode, "video", upstreamModel)),
  ...GOOGLE_IMAGE_ROUTES.map(([modelCode]) => falMock(modelCode, "image", "fal-ai/nano-banana-2")),
  ...GOOGLE_VIDEO_ROUTES.map(([modelCode]) => falMock(modelCode, "video", modelCode.includes("fast") ? "fal-ai/veo3/fast" : "fal-ai/veo3")),
  ...GOOGLE_AUDIO_ROUTES.map(([modelCode]) => falMock(modelCode, "audio", "fal-ai/minimax/speech-02-hd")),
  falMock("gpt-image-2", "image", "fal-ai/nano-banana-2"),
  falMock("minimax-tts", "audio", "fal-ai/minimax/speech-02-hd"),
  falMock("elevenlabs-tts", "audio", "fal-ai/minimax/speech-02-hd"),
];

export const MODEL_UPSTREAM_ROUTES: ModelUpstreamRoute[] = [
  ...MODEL_DECLARED_ROUTES,
  ...MOCK_DECLARED_ROUTES,
  ...MOCK_ROUTES,
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
    requiredCredentials: query.allowMock ? undefined : [API_KEY_CREDENTIAL],
  };
}

function providerIdForRoute(route: ModelUpstreamRoute): ProviderAccountId {
  if (route.providerId) return route.providerId;
  if (route.upstreamId === "local") return "local";
  if (
    route.upstreamId === "openai" ||
    route.upstreamId === "google-ai-studio" ||
    route.upstreamId === "google-agent-platform" ||
    route.upstreamId === "anthropic"
  ) return "official";
  if (route.upstreamId === "fal" || route.upstreamId === "kie" || route.upstreamId === "replicate" || route.upstreamId === "mock") {
    return route.upstreamId;
  }
  return "custom";
}

export interface ProviderModelSupport {
  providerId: ProviderAccountId;
  upstreamId: ModelUpstreamId;
  region?: string;
  models: Array<{
    id: string;
    name: string;
    kind: ModelKind;
    upstreamModel: string;
    apiShape: ModelUpstreamApiShape;
    requiredCredentials: string[];
    requiredOAuth: ProviderOAuthId[];
  }>;
  requiredCredentials: string[];
  requiredOAuth: ProviderOAuthId[];
}

export interface InvalidProviderModelFilter {
  providerId: ProviderAccountId;
  upstreamId?: ModelUpstreamId;
  region?: string;
  unsupportedModelIds: string[];
}

export function listProviderModelSupport(options: {
  models?: readonly ModelCard[];
  includeMock?: boolean;
} = {}): ProviderModelSupport[] {
  const includeMock = options.includeMock ?? false;
  const models = options.models ?? (includeMock ? [...MODEL_CARDS, ...MOCK_MODEL_CARDS] : MODEL_CARDS);
  const modelById = new Map(models.map((model) => [model.id, model]));
  const modelDeclaredRoutes = routesFromModelCards(models);
  const routes = modelDeclaredRoutes.length > 0
    ? includeMock
      ? [...modelDeclaredRoutes, ...MOCK_ROUTES]
      : modelDeclaredRoutes
    : MODEL_UPSTREAM_ROUTES;
  const rows = new Map<string, ProviderModelSupport>();
  for (const route of routes) {
    if (!includeMock && route.upstreamId === "mock") continue;
    const model = modelById.get(route.modelCode);
    if (!model) continue;
    const providerId = providerIdForRoute(route);
    const key = [providerId, route.upstreamId, route.region ?? ""].join(":");
    const row = rows.get(key) ?? {
      providerId,
      upstreamId: route.upstreamId,
      ...(route.region ? { region: route.region } : {}),
      models: [],
      requiredCredentials: [],
      requiredOAuth: [],
    };
    row.models.push({
      id: model.id,
      name: model.name,
      kind: route.kind,
      upstreamModel: route.upstreamModel,
      apiShape: route.apiShape,
      requiredCredentials: [...(route.requiredCredentials ?? [])],
      requiredOAuth: [...(route.requiredOAuth ?? [])],
    });
    row.requiredCredentials = [...new Set([...row.requiredCredentials, ...(route.requiredCredentials ?? [])])].sort();
    row.requiredOAuth = [...new Set([...row.requiredOAuth, ...(route.requiredOAuth ?? [])])].sort();
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) =>
    [a.providerId, a.upstreamId, a.region ?? ""].join(":").localeCompare([b.providerId, b.upstreamId, b.region ?? ""].join(":")),
  );
}

export function unsupportedProviderModelFilterIds(
  provider: Pick<ProviderAccountAvailability, "providerId" | "upstreamId" | "region" | "supportedModelIds">,
  options: { models?: readonly ModelCard[]; includeMock?: boolean } = {},
): string[] {
  if (!provider.supportedModelIds?.length) return [];
  const support = listProviderModelSupport({
    models: options.models,
    includeMock: options.includeMock ?? true,
  }).find((row) =>
    row.providerId === provider.providerId &&
    (!provider.upstreamId || row.upstreamId === provider.upstreamId) &&
    (row.region ?? "") === (provider.region ?? "")
  );
  if (!support) return [...provider.supportedModelIds];
  const supported = new Set(support.models.map((model) => model.id));
  return provider.supportedModelIds.filter((id) => !supported.has(id));
}

export function invalidProviderModelFilters(
  providers: readonly Pick<ProviderAccountAvailability, "providerId" | "upstreamId" | "region" | "supportedModelIds">[],
  options: { models?: readonly ModelCard[]; includeMock?: boolean } = {},
): InvalidProviderModelFilter[] {
  return providers.flatMap((provider) => {
    const unsupportedModelIds = unsupportedProviderModelFilterIds(provider, options);
    if (unsupportedModelIds.length === 0) return [];
    return [{
      providerId: provider.providerId,
      ...(provider.upstreamId ? { upstreamId: provider.upstreamId } : {}),
      ...(provider.region ? { region: provider.region } : {}),
      unsupportedModelIds,
    }];
  });
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

function matchesProviderAccount(route: ModelUpstreamRoute, provider: ProviderAccountAvailability): boolean {
  if (provider.providerId !== providerIdForRoute(route)) return false;
  if (provider.upstreamId && provider.upstreamId !== route.upstreamId) return false;
  if (provider.region && route.region && provider.region !== route.region) return false;
  if (provider.supportedModelIds?.length && !provider.supportedModelIds.includes(route.modelCode)) return false;
  return true;
}

type ProviderAccountCandidate = {
  provider: ProviderAccountAvailability;
  index: number;
};

function providerCandidates(
  configuredProviders: ProviderAccountAvailability[] | undefined,
  route: ModelUpstreamRoute,
): ProviderAccountCandidate[] {
  return (configuredProviders ?? [])
    .map((provider, index) => ({ provider, index }))
    .filter((candidate) => matchesProviderAccount(route, candidate.provider));
}

function compareProviderCandidates(a: ProviderAccountCandidate, b: ProviderAccountCandidate): number {
  const priority = (a.provider.priority ?? 1000) - (b.provider.priority ?? 1000);
  if (priority !== 0) return priority;
  const weight = (b.provider.weight ?? 0) - (a.provider.weight ?? 0);
  if (weight !== 0) return weight;
  return a.index - b.index;
}

function canServeRoute(route: ModelUpstreamRoute, provider: ProviderAccountAvailability): boolean {
  return provider.enabled !== false && hasRequiredCredentials(route, provider) && hasRequiredOAuth(route, provider);
}

function providerCandidate(
  configuredProviders: ProviderAccountAvailability[] | undefined,
  route: ModelUpstreamRoute,
): ProviderAccountCandidate | undefined {
  const candidates = providerCandidates(configuredProviders, route);
  if (!candidates.length) return undefined;
  const runnable = candidates
    .filter((candidate) => canServeRoute(route, candidate.provider))
    .sort(compareProviderCandidates);
  if (runnable[0]) return runnable[0];
  const enabled = candidates
    .filter((candidate) => candidate.provider.enabled !== false)
    .sort(compareProviderCandidates);
  if (enabled[0]) return enabled[0];
  return candidates.sort(compareProviderCandidates)[0];
}

function providerIndex(configuredProviders: ProviderAccountAvailability[] | undefined, route: ModelUpstreamRoute): number {
  return providerCandidate(configuredProviders, route)?.index ?? Number.POSITIVE_INFINITY;
}

function providerConfig(
  configuredProviders: ProviderAccountAvailability[] | undefined,
  route: ModelUpstreamRoute,
): ProviderAccountAvailability | undefined {
  return providerCandidate(configuredProviders, route)?.provider;
}

function modelPriority(
  config: ProviderAccountAvailability | UpstreamAvailability | undefined,
  modelCode: string,
): number | undefined {
  if (!config || !("modelPriorities" in config)) return undefined;
  const priority = config.modelPriorities?.[modelCode];
  return typeof priority === "number" && Number.isFinite(priority) ? priority : undefined;
}

function modelPriorityForRoute(
  query: Pick<ModelUpstreamRouteQuery, "configuredProviders" | "configuredUpstreams">,
  route: ModelUpstreamRoute,
  modelCode: string,
): number | undefined {
  if (query.configuredProviders) {
    const priorities = providerCandidates(query.configuredProviders, route)
      .map((candidate) => modelPriority(candidate.provider, modelCode))
      .filter((priority): priority is number => priority !== undefined);
    return priorities.length ? Math.min(...priorities) : undefined;
  }
  return modelPriority(upstreamConfig(query.configuredUpstreams, route.upstreamId), modelCode);
}

function configForRoute(
  query: Pick<ModelUpstreamRouteQuery, "configuredProviders" | "configuredUpstreams">,
  route: ModelUpstreamRoute,
): ProviderAccountAvailability | UpstreamAvailability | undefined {
  if (query.configuredProviders) return providerConfig(query.configuredProviders, route);
  return upstreamConfig(query.configuredUpstreams, route.upstreamId);
}

function missingRequiredCredentials(
  route: ModelUpstreamRoute,
  config: ProviderAccountAvailability | UpstreamAvailability | undefined,
): string[] {
  if (!route.requiredCredentials?.length) return [];
  if (!config) return [];
  if (config.configuredCredentials === undefined) return [...route.requiredCredentials];
  return route.requiredCredentials.filter((credential) => !config.configuredCredentials?.includes(credential));
}

function hasRequiredCredentials(
  route: ModelUpstreamRoute,
  config: ProviderAccountAvailability | UpstreamAvailability | undefined,
): boolean {
  if (!route.requiredCredentials?.length) return true;
  if (!config) return true;
  return missingRequiredCredentials(route, config).length === 0;
}

function missingRequiredOAuth(
  route: ModelUpstreamRoute,
  config: ProviderAccountAvailability | UpstreamAvailability | undefined,
): ProviderOAuthId[] {
  if (!route.requiredOAuth?.length) return [];
  if (!config) return [];
  if (config.availableOAuth === undefined) return [...route.requiredOAuth];
  return route.requiredOAuth.filter((provider) => !config.availableOAuth?.includes(provider));
}

function hasRequiredOAuth(
  route: ModelUpstreamRoute,
  config: ProviderAccountAvailability | UpstreamAvailability | undefined,
): boolean {
  if (!route.requiredOAuth?.length) return true;
  if (!config) return true;
  return missingRequiredOAuth(route, config).length === 0;
}

function isEnabled(route: ModelUpstreamRoute, query: ModelUpstreamRouteQuery): boolean {
  if (route.upstreamId === "local") return true;
  if (route.upstreamId === "mock" && !query.allowMock) return false;
  if (!query.configuredUpstreams && !query.configuredProviders) return true;
  const config = configForRoute(query, route);
  if (!config || config.enabled === false) return false;
  return hasRequiredCredentials(route, config) && hasRequiredOAuth(route, config);
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
      const aModelPriority = modelPriorityForRoute(query, a, query.modelCode);
      const bModelPriority = modelPriorityForRoute(query, b, query.modelCode);
      if (aModelPriority !== undefined || bModelPriority !== undefined) {
        const priority = (aModelPriority ?? Number.POSITIVE_INFINITY) - (bModelPriority ?? Number.POSITIVE_INFINITY);
        if (priority !== 0) return priority;
      }
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

function shouldAllowMockCatalogRoutes(options: {
  configuredProviders?: ProviderAccountAvailability[];
  configuredUpstreams?: UpstreamAvailability[];
  allowMock?: boolean;
}): boolean {
  if (options.allowMock) return true;
  if (options.configuredProviders?.some((provider) => provider.providerId === "mock" && provider.enabled !== false)) return true;
  return !!options.configuredUpstreams?.some((upstream) => upstream.upstreamId === "mock" && upstream.enabled !== false);
}

export function listModelCatalogEntries(options: {
  models?: readonly ModelCard[];
  configuredProviders?: ProviderAccountAvailability[];
  configuredUpstreams?: UpstreamAvailability[];
  allowMock?: boolean;
} = {}): ModelCatalogEntry[] {
  const allowMock = shouldAllowMockCatalogRoutes(options);
  const models = options.models ?? (allowMock ? [...MODEL_CARDS, ...MOCK_MODEL_CARDS] : MODEL_CARDS);
  return models.map((model) => {
    const query: ModelUpstreamRouteQuery = {
      modelCode: model.id,
      kind: model.kind,
      configuredProviders: options.configuredProviders,
      configuredUpstreams: options.configuredUpstreams,
      allowMock,
    };
    const allRoutes = candidateRoutes({ modelCode: model.id, kind: model.kind, allowMock });
    const routes = listModelUpstreamRoutes(query);
    const selectedRoute = routes[0] ?? null;
    const configuredCandidates = allRoutes.filter((route) => {
      const config = configForRoute(query, route);
      return !!config && config.enabled !== false;
    });
    const missingCredentials = [
      ...new Set(configuredCandidates.flatMap((route) => missingRequiredCredentials(route, configForRoute(query, route)))),
    ];
    const missingOAuth = [
      ...new Set(configuredCandidates.flatMap((route) => missingRequiredOAuth(route, configForRoute(query, route)))),
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
      missingCredentials,
      missingOAuth,
    };
  });
}

export const listModelProviderRoutes = listModelUpstreamRoutes;
export const resolveModelProviderRoute = resolveModelUpstreamRoute;
