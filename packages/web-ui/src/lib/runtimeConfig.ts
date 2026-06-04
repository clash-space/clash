import {
  apiUrl,
  assetFallbackUrl,
  resolveRuntimeConfig,
  webSocketUrl,
  type RuntimeCapabilities,
  type ResolvedRuntimeEndpointConfig,
  type RuntimeEndpointConfig,
} from "@clash/shared-runtime";

declare global {
  var __CLASH_RUNTIME_CONFIG__: RuntimeEndpointConfig | undefined;
}

interface LocationLike {
  protocol: string;
  host: string;
}

function browserLocation(): LocationLike | undefined {
  if (typeof window === "undefined") return undefined;
  return window.location;
}

function wsBaseFromLocation(location: LocationLike | undefined): string {
  if (!location) return "";
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}`;
}

export function getRuntimeConfig(): ResolvedRuntimeEndpointConfig {
  return resolveRuntimeConfig(globalThis.__CLASH_RUNTIME_CONFIG__ ?? {});
}

export function getRuntimeCapabilities(): RuntimeCapabilities {
  return getRuntimeConfig().capabilities;
}

export function runtimeApiUrl(path: string): string {
  return apiUrl(path, getRuntimeConfig());
}

export function runtimeAssetFallbackUrl(storageKey: string): string {
  return assetFallbackUrl(storageKey, getRuntimeConfig());
}

export function runtimeSyncWebSocketUrl(
  projectId: string,
  location: LocationLike | undefined = browserLocation(),
): string {
  return runtimeWebSocketUrl(`/sync/${encodeURIComponent(projectId)}`, location);
}

export function runtimeWebSocketUrl(
  path: string,
  location: LocationLike | undefined = browserLocation(),
): string {
  const cfg = getRuntimeConfig();
  if (cfg.wsBaseUrl) return webSocketUrl(path, cfg);
  return webSocketUrl(path, {
    ...cfg,
    wsBaseUrl: wsBaseFromLocation(location),
  });
}
