type ViteEnv = {
  VITE_CLASH_API_BASE_URL?: string;
  VITE_CLASH_WS_BASE_URL?: string;
} & Record<string, unknown>;

type RuntimeEndpointConfig = {
  mode?: "hosted" | "local" | "desktop";
  apiBaseUrl?: string;
  wsBaseUrl?: string;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function installViteRuntimeConfig(env: ViteEnv): void {
  const apiBaseUrl = env.VITE_CLASH_API_BASE_URL?.trim();
  if (!apiBaseUrl) return;

  const wsBaseUrl = env.VITE_CLASH_WS_BASE_URL?.trim();
  (globalThis as typeof globalThis & {
    __CLASH_RUNTIME_CONFIG__?: RuntimeEndpointConfig;
  }).__CLASH_RUNTIME_CONFIG__ = {
    mode: "desktop",
    apiBaseUrl: trimTrailingSlash(apiBaseUrl),
    ...(wsBaseUrl ? { wsBaseUrl: trimTrailingSlash(wsBaseUrl) } : {}),
  };
}
