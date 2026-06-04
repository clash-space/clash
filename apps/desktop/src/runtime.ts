import { resolveRuntimeConfig, type RuntimeCapabilities, type RuntimeCapabilityOverrides } from "@clash/shared-runtime";

export interface DesktopRuntimeInput {
  apiPort: number;
  apiBaseUrl?: string;
  wsBaseUrl?: string;
  webUrl?: string;
  capabilities?: RuntimeCapabilityOverrides;
}

export interface DesktopRuntime {
  mode: "desktop";
  apiBaseUrl: string;
  wsBaseUrl: string;
  webUrl: string;
  capabilities: RuntimeCapabilities;
}

export function resolveDesktopRuntime(input: DesktopRuntimeInput): DesktopRuntime {
  const runtime = resolveRuntimeConfig({
    mode: "desktop",
    apiBaseUrl: input.apiBaseUrl ?? `http://127.0.0.1:${input.apiPort}`,
    wsBaseUrl: input.wsBaseUrl,
    capabilities: input.capabilities,
  });
  return {
    mode: "desktop",
    apiBaseUrl: runtime.apiBaseUrl,
    wsBaseUrl: runtime.wsBaseUrl,
    webUrl: input.webUrl ?? "clash://app/",
    capabilities: runtime.capabilities,
  };
}
