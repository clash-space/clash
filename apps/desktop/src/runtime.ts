import {
  resolveRuntimeConfig,
  type RuntimeCapabilities,
  type RuntimeCapabilityOverrides,
} from "@clash/shared-runtime";
import {
  resolveAvailableDesktopApiPort,
  type ResolvedDesktopApiPort,
} from "./api-port";

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

export function resolveDesktopRendererUrl(input: {
  isPackaged: boolean;
  useBuiltRenderer?: boolean;
  forgeDevServerUrl: string | undefined;
  explicitWebUrl: string | undefined;
}): string | undefined {
  const liveUrl = input.forgeDevServerUrl ?? input.explicitWebUrl;
  if (liveUrl) return liveUrl;
  if (input.isPackaged || input.useBuiltRenderer) return undefined;
  throw new Error(
    "Desktop development requires MAIN_WINDOW_VITE_DEV_SERVER_URL; refusing to fall back to stale packaged Web assets",
  );
}

export function resolveDesktopHostStartupTimeoutMs(
  value: string | undefined,
): number | undefined {
  if (!value) return undefined;
  const timeoutMs = Number(value);
  return Number.isSafeInteger(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : undefined;
}

export function shouldWatchDesktopSourceHost(
  value: string | undefined,
): boolean {
  return value === "1";
}

export async function resolveDesktopSourceHostDaemonEnv(
  options: {
    sourceHost: boolean;
    watchSourceHost: boolean;
    envPort: string | undefined;
  },
  resolvePort: (options: {
    envPort?: string;
  }) => Promise<ResolvedDesktopApiPort> = resolveAvailableDesktopApiPort,
): Promise<NodeJS.ProcessEnv> {
  if (!options.sourceHost || !options.watchSourceHost) return {};
  const resolved = await resolvePort({ envPort: options.envPort });
  return { PORT: String(resolved.port) };
}

export function resolveDesktopSourceHostNodeArgs(options: {
  watch: boolean;
  tsxLoaderPath: string;
  tsxCliPath: string;
  tsconfigPath: string;
  pluginsRoot: string;
}): readonly string[] {
  return options.watch
    ? [
        options.tsxCliPath,
        "watch",
        "--exclude",
        `${options.pluginsRoot}/*/dist/**`,
        "--tsconfig",
        options.tsconfigPath,
      ]
    : ["--import", options.tsxLoaderPath];
}

export function resolveDesktopRuntime(
  input: DesktopRuntimeInput,
): DesktopRuntime {
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
