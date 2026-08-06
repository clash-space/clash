export type RuntimeMode = "hosted" | "local" | "desktop";

export {
  planCascadeTick,
  type CascadeAdoptDecision,
  type CascadeClearDecision,
  type CascadeClearReason,
  type CascadeDecision,
  type CascadeGraphEdge,
  type CascadeGraphNode,
  type CascadeTickInput,
  type CascadeTickPlan,
} from "./cascade-scheduler.js";

export {
  generateTextCompletion,
  type TextContentPart,
  type TextGenerationInput,
  type TextGenerationMessage,
  type TextGenerationResult,
  type TextProviderKind,
} from "./text-generation.js";

export { visibleUserPromptText } from "./prompt-content.js";

export {
  buildMiniMaxH3Content,
  type MiniMaxH3ContentInput,
  type MiniMaxH3OrderedContentPart,
} from "./minimax-h3.js";

export {
  buildBflFlux3VideoRequest,
  generateBflFlux3Video,
  resolveFlux3KeyframeIndices,
  type BflFlux3VideoInput,
  type BflFlux3VideoRequestOptions,
  type BflFlux3VideoResult,
} from "./bfl-video.js";

export {
  createGeminiOmniInteraction,
  downloadGeminiOmniVideo,
  extractGeminiOmniVideo,
  geminiOmniInteractionId,
  geminiOmniInteractionStatus,
  getGeminiOmniInteraction,
  type CreateGeminiOmniInteractionInput,
  type GeminiOmniInputPart,
  type GeminiOmniInteraction,
  type GeminiOmniVideoOutput,
  type GetGeminiOmniInteractionInput,
} from "./gemini-omni.js";

export {
  createPikaMediaJob,
  getPikaMediaContent,
  PIKA_MEDIA_BASE_URL,
  uploadPikaMedia,
  waitForPikaMediaJob,
  type PikaMediaJob,
  type PikaMediaStatus,
} from "./pika-media.js";

export { generatePikaChat, type PikaChatResult } from "./pika-chat.js";

export {
  fetchPikaCatalogQuote,
  pikaBillingBasis,
  quotePikaCatalogRequest,
  type PikaCatalogEntry,
  type PikaCatalogPriceTier,
  type PikaCatalogPricingComponent,
  type PikaCatalogQuote,
  type PikaQuoteComponent,
} from "./pika-pricing.js";

export {
  buildProjectRecoveryPolicy,
  buildProjectStatus,
  PROJECT_TIMELINE_APPLY_COMMAND,
  PROJECT_TIMELINE_FILE_PATTERN,
  PROJECT_TIMELINE_PUBLIC_COMMANDS,
  PROJECT_TIMELINE_PULL_COMMAND,
  projectIdPathSegment,
  projectWorkspaceId,
  type ProjectRecoveryPolicy,
  type ProjectRecoveryPolicyReason,
  type ProjectStatusActionGate,
  type ProjectStatusActionGateReason,
  type ProjectStatusActionGates,
  type ProjectStatus,
  type ProjectReplicationState,
  type ProjectStatusContext,
  type ProjectStatusCurrentWorkspace,
  type ProjectStatusMarker,
  type ProjectStatusStorage,
  type ProjectStatusSource,
  type ProjectWorkspaceIdKind,
} from "./project-status.js";

export const LOCAL_HOST_RECORD_SCHEMA_VERSION = 1;
export const LOCAL_HOST_PROTOCOL_VERSION = 1;
export const LOCAL_HOST_DATA_SCHEMA_VERSION = 1;

export type HostLaunchMode = "desktop" | "plugin" | "cli-once" | "user-service" | "launchd";

export type HostStartedBy = "desktop" | "plugin" | "cli" | "user-service" | "launchd";

export interface LocalHostDiscoveryRecord {
  schemaVersion: typeof LOCAL_HOST_RECORD_SCHEMA_VERSION;
  protocolVersion: number;
  dataSchemaVersion: number;
  hostId: string;
  endpoint: string;
  pid: number;
  launchMode: HostLaunchMode;
  startedBy: HostStartedBy;
  /** Runtime channel that owns this host. Missing legacy records are production. */
  profile?: "dev" | "prod";
  agentCliPath?: string;
  ownerClientId?: string;
  /** 0600-file-only bearer used by a separately managed Bridge to reach the local Kernel broker. */
  pluginBrokerToken?: string;
  startedAt: string;
  updatedAt: string;
}

export interface LocalHostShutdownClient {
  clientKind: "desktop" | "plugin" | "cli" | "user-service" | "launchd";
  clientId?: string;
}

export function isLocalHostDiscoveryRecord(value: unknown): value is LocalHostDiscoveryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<LocalHostDiscoveryRecord>;
  return (
    record.schemaVersion === LOCAL_HOST_RECORD_SCHEMA_VERSION
    && typeof record.protocolVersion === "number"
    && Number.isInteger(record.protocolVersion)
    && typeof record.dataSchemaVersion === "number"
    && Number.isInteger(record.dataSchemaVersion)
    && typeof record.hostId === "string"
    && record.hostId.length > 0
    && typeof record.endpoint === "string"
    && record.endpoint.length > 0
    && typeof record.pid === "number"
    && Number.isInteger(record.pid)
    && record.pid > 0
    && isHostLaunchMode(record.launchMode)
    && isHostStartedBy(record.startedBy)
    && (record.profile === undefined || record.profile === "dev" || record.profile === "prod")
    && (record.agentCliPath === undefined || (typeof record.agentCliPath === "string" && record.agentCliPath.length > 0))
    && (record.ownerClientId === undefined || typeof record.ownerClientId === "string")
    && (record.pluginBrokerToken === undefined
      || (typeof record.pluginBrokerToken === "string" && record.pluginBrokerToken.length >= 32))
    && typeof record.startedAt === "string"
    && typeof record.updatedAt === "string"
  );
}

export function isCompatibleHost(
  record: LocalHostDiscoveryRecord,
  clientProtocolVersion: number,
): boolean {
  return (
    record.schemaVersion === LOCAL_HOST_RECORD_SCHEMA_VERSION
    && record.protocolVersion <= clientProtocolVersion
  );
}

export function shouldClientOwnShutdown(
  record: LocalHostDiscoveryRecord,
  client: LocalHostShutdownClient,
): boolean {
  if (!record.ownerClientId || !client.clientId || record.ownerClientId !== client.clientId) {
    return false;
  }
  if (record.launchMode === "desktop") {
    return record.startedBy === "desktop" && client.clientKind === "desktop";
  }
  if (record.launchMode === "plugin") {
    return record.startedBy === "plugin" && client.clientKind === "plugin";
  }
  return false;
}

function isHostLaunchMode(value: unknown): value is HostLaunchMode {
  return (
    value === "desktop"
    || value === "plugin"
    || value === "cli-once"
    || value === "user-service"
    || value === "launchd"
  );
}

function isHostStartedBy(value: unknown): value is HostStartedBy {
  return (
    value === "desktop"
    || value === "plugin"
    || value === "cli"
    || value === "user-service"
    || value === "launchd"
  );
}

export interface RuntimeCapabilities {
  assets: {
    storage: "cloud" | "local";
    signing: "signed" | "unsigned";
    upload: "remote" | "local";
  };
  workflows: {
    runner: "cloudflare" | "local-node" | "disabled";
    mediaPostprocess: "cloud" | "local-node" | "disabled";
  };
  loro: {
    persistence: "remote" | "local" | "hybrid";
    sync: "durable-object" | "local-websocket";
  };
  auth: {
    mode: "better-auth" | "local-user";
  };
}

export type RuntimeCapabilityOverrides = {
  [K in keyof RuntimeCapabilities]?: Partial<RuntimeCapabilities[K]>;
};

export interface RuntimeEndpointConfig {
  /**
   * Runtime deployment mode. Hosted means same-origin Cloudflare backend;
   * local means a standalone local Node backend; desktop means Electron-hosted
   * local backend plus bundled/web-served UI.
   */
  mode?: RuntimeMode;
  /**
   * HTTP origin for the backend that serves /api, /assets, /upload, etc.
   * Empty means same-origin relative URLs.
   */
  apiBaseUrl?: string;
  /**
   * WebSocket origin for /sync and agent streams. When omitted, it is derived
   * from apiBaseUrl. Empty means caller should use the current browser origin.
   */
  wsBaseUrl?: string;
  /**
   * Optional capability overrides for hybrid experiments: e.g. desktop UI
   * talking to local assets but remote Loro persistence.
   */
  capabilities?: RuntimeCapabilityOverrides;
}

export interface ResolvedRuntimeEndpointConfig {
  mode: RuntimeMode;
  apiBaseUrl: string;
  wsBaseUrl: string;
  capabilities: RuntimeCapabilities;
}

export const desktopChromeMetrics = {
  tabStripHeight: 40,
  nativeWindowButtonFrameSize: 20,
  trafficLightInsetX: 12,
  trafficLightOpticalOffsetY: 2,
  toolbarLeftInset: 92,
} as const;

export const desktopTrafficLightPosition = {
  x: desktopChromeMetrics.trafficLightInsetX,
  y: Math.round(
    (desktopChromeMetrics.tabStripHeight - desktopChromeMetrics.nativeWindowButtonFrameSize) / 2,
  ) + desktopChromeMetrics.trafficLightOpticalOffsetY,
} as const;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function withLeadingSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function isAbsoluteResource(value: string): boolean {
  return /^(https?:|wss?:|blob:|data:|file:)/.test(value);
}

function deriveWsBaseUrl(apiBaseUrl: string): string {
  if (!apiBaseUrl) return "";
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return trimTrailingSlash(url.toString());
}

export function defaultRuntimeCapabilities(mode: RuntimeMode): RuntimeCapabilities {
  if (mode === "hosted") {
    return {
      assets: { storage: "cloud", signing: "signed", upload: "remote" },
      workflows: { runner: "cloudflare", mediaPostprocess: "cloud" },
      loro: { persistence: "remote", sync: "durable-object" },
      auth: { mode: "better-auth" },
    };
  }

  return {
    assets: { storage: "local", signing: "unsigned", upload: "local" },
    workflows: {
      runner: "local-node",
      mediaPostprocess: "disabled",
    },
    loro: { persistence: "local", sync: "local-websocket" },
    auth: { mode: "local-user" },
  };
}

function mergeRuntimeCapabilities(
  base: RuntimeCapabilities,
  overrides: RuntimeCapabilityOverrides | undefined,
): RuntimeCapabilities {
  if (!overrides) return base;
  return {
    assets: { ...base.assets, ...overrides.assets },
    workflows: { ...base.workflows, ...overrides.workflows },
    loro: { ...base.loro, ...overrides.loro },
    auth: { ...base.auth, ...overrides.auth },
  };
}

export function resolveRuntimeConfig(
  input: RuntimeEndpointConfig = {},
): ResolvedRuntimeEndpointConfig {
  const mode = input.mode ?? "hosted";
  const apiBaseUrl = input.apiBaseUrl ? trimTrailingSlash(input.apiBaseUrl) : "";
  const wsBaseUrl = input.wsBaseUrl
    ? trimTrailingSlash(input.wsBaseUrl)
    : deriveWsBaseUrl(apiBaseUrl);
  const capabilities = mergeRuntimeCapabilities(
    defaultRuntimeCapabilities(mode),
    input.capabilities,
  );
  return { mode, apiBaseUrl, wsBaseUrl, capabilities };
}

export function apiUrl(
  path: string,
  config: ResolvedRuntimeEndpointConfig | RuntimeEndpointConfig = {},
): string {
  if (isAbsoluteResource(path)) return path;
  const cfg = "apiBaseUrl" in config && "wsBaseUrl" in config
    ? (config as ResolvedRuntimeEndpointConfig)
    : resolveRuntimeConfig(config);
  const normalizedPath = withLeadingSlash(path);
  return cfg.apiBaseUrl ? `${cfg.apiBaseUrl}${normalizedPath}` : normalizedPath;
}

export function assetFallbackUrl(
  storageKey: string,
  config: ResolvedRuntimeEndpointConfig | RuntimeEndpointConfig = {},
): string {
  if (isAbsoluteResource(storageKey)) return storageKey;
  const key = storageKey.startsWith("/") ? storageKey.slice(1) : storageKey;
  return apiUrl(`/assets/${key}`, config);
}

export function syncWebSocketUrl(
  projectId: string,
  config: ResolvedRuntimeEndpointConfig | RuntimeEndpointConfig = {},
): string {
  return webSocketUrl(`/sync/${encodeURIComponent(projectId)}`, config);
}

export function webSocketUrl(
  path: string,
  config: ResolvedRuntimeEndpointConfig | RuntimeEndpointConfig = {},
): string {
  const cfg = "apiBaseUrl" in config && "wsBaseUrl" in config
    ? (config as ResolvedRuntimeEndpointConfig)
    : resolveRuntimeConfig(config);
  if (isAbsoluteResource(path)) return path;
  const normalizedPath = withLeadingSlash(path);
  return cfg.wsBaseUrl ? `${cfg.wsBaseUrl}${normalizedPath}` : normalizedPath;
}
