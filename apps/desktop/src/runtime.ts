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

export function resolveDesktopHostStartupTimeoutMs(
  env: Record<string, string | undefined>,
): number | undefined {
  const raw = env.CLASH_DESKTOP_HOST_STARTUP_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") return undefined;
  const timeoutMs = Number(raw);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
    throw new Error(
      "Desktop Host startup timeout must be an integer between 1000 and 300000 milliseconds",
    );
  }
  return timeoutMs;
}

export function useDesktopSourceHostWatch(
  env: Record<string, string | undefined>,
): boolean {
  return env.CLASH_DESKTOP_SOURCE_HOST_WATCH !== "0";
}

export function resolveDesktopHostStdio(
  env: Record<string, string | undefined>,
): "ignore" | "inherit" | undefined {
  const value = env.CLASH_DESKTOP_HOST_STDIO?.trim();
  if (!value) return undefined;
  if (value === "ignore" || value === "inherit") return value;
  throw new Error("Desktop Host stdio must be ignore or inherit");
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
