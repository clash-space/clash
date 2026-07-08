export type RuntimeMode = "hosted" | "local" | "desktop";

export {
  generateTextCompletion,
  type TextContentPart,
  type TextGenerationInput,
  type TextGenerationMessage,
  type TextGenerationResult,
  type TextProviderKind,
} from "./text-generation.js";

export {
  buildProjectStatus,
  projectIdPathSegment,
  type ProjectStatusActionGate,
  type ProjectStatusActionGateReason,
  type ProjectStatusActionGates,
  type ProjectStatus,
  type ProjectStatusContext,
  type ProjectStatusCurrentWorkspace,
  type ProjectStatusMarker,
  type ProjectStatusStorage,
  type ProjectStatusSource,
} from "./project-status.js";

export const LOCAL_HOST_RECORD_SCHEMA_VERSION = 1;
export const LOCAL_HOST_PROTOCOL_VERSION = 1;
export const LOCAL_HOST_DATA_SCHEMA_VERSION = 1;

export type HostLaunchMode = "desktop" | "cli-once" | "user-service" | "launchd";

export type HostStartedBy = "desktop" | "cli" | "user-service" | "launchd";

export interface LocalHostDiscoveryRecord {
  schemaVersion: typeof LOCAL_HOST_RECORD_SCHEMA_VERSION;
  protocolVersion: number;
  dataSchemaVersion: number;
  hostId: string;
  endpoint: string;
  pid: number;
  launchMode: HostLaunchMode;
  startedBy: HostStartedBy;
  ownerClientId?: string;
  startedAt: string;
  updatedAt: string;
}

export interface LocalHostShutdownClient {
  clientKind: "desktop" | "cli" | "user-service" | "launchd";
  clientId?: string;
}

export function isLocalHostDiscoveryRecord(value: unknown): value is LocalHostDiscoveryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<LocalHostDiscoveryRecord>;
  return record.schemaVersion === LOCAL_HOST_RECORD_SCHEMA_VERSION
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
    && (record.ownerClientId === undefined || typeof record.ownerClientId === "string")
    && typeof record.startedAt === "string"
    && typeof record.updatedAt === "string";
}

export function isCompatibleHost(
  record: LocalHostDiscoveryRecord,
  clientProtocolVersion: number,
): boolean {
  return record.schemaVersion === LOCAL_HOST_RECORD_SCHEMA_VERSION
    && record.protocolVersion <= clientProtocolVersion;
}

export function shouldClientOwnShutdown(
  record: LocalHostDiscoveryRecord,
  client: LocalHostShutdownClient,
): boolean {
  if (record.launchMode !== "desktop") return false;
  if (record.startedBy !== "desktop") return false;
  if (client.clientKind !== "desktop") return false;
  return Boolean(record.ownerClientId && client.clientId && record.ownerClientId === client.clientId);
}

function isHostLaunchMode(value: unknown): value is HostLaunchMode {
  return value === "desktop"
    || value === "cli-once"
    || value === "user-service"
    || value === "launchd";
}

function isHostStartedBy(value: unknown): value is HostStartedBy {
  return value === "desktop"
    || value === "cli"
    || value === "user-service"
    || value === "launchd";
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
