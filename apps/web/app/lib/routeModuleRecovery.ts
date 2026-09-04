export type RouteModuleRecoveryResult =
  "reloaded" | "already-retried" | "unavailable" | "ignored";

type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const recoveryStorageKey = "clash:route-module-recovery";
const dynamicImportFailurePattern =
  /Failed to fetch dynamically imported module:\s+(https?:\/\/\S+)/i;
const invalidExportFailurePattern =
  /The requested module\s+['"]([^'"]+)['"]\s+does not provide an export named/i;

function failedModuleUrl(error: unknown, origin: string): URL | null {
  if (!(error instanceof Error)) return null;
  const candidate =
    dynamicImportFailurePattern.exec(error.message)?.[1] ??
    invalidExportFailurePattern.exec(error.message)?.[1];
  if (!candidate) return null;

  try {
    const url = new URL(candidate, `${origin}/`);
    return url.origin === origin ? url : null;
  } catch {
    return null;
  }
}

export function isRecoverableRouteModuleError(
  error: unknown,
  origin: string,
): boolean {
  return failedModuleUrl(error, origin) !== null;
}

function defaultRecoverySleep(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 250));
}

export async function recoverFailedRouteModule(_options: {
  error: unknown;
  origin: string;
  fetchModule: (
    url: string,
    init?: RequestInit,
  ) => Promise<Pick<Response, "ok" | "headers">>;
  reload: () => void;
  storage: RecoveryStorage;
  sleep?: () => Promise<void>;
  maxAttempts?: number;
}): Promise<RouteModuleRecoveryResult> {
  const {
    error,
    origin,
    fetchModule,
    reload,
    storage,
    sleep = defaultRecoverySleep,
    maxAttempts = 40,
  } = _options;
  const moduleUrl = failedModuleUrl(error, origin);
  if (!moduleUrl) return "ignored";
  if (storage.getItem(recoveryStorageKey) === moduleUrl.href) {
    return "already-retried";
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetchModule(moduleUrl.href, {
        cache: "no-store",
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (response.ok && /(?:java|type|ecma)script/i.test(contentType)) {
        storage.setItem(recoveryStorageKey, moduleUrl.href);
        reload();
        return "reloaded";
      }
    } catch {
      // The renderer may be between Vite restarts. Retry within the bounded
      // recovery window instead of committing the route to an error surface.
    }

    if (attempt + 1 < maxAttempts) await sleep();
  }
  return "unavailable";
}

export function clearRouteModuleRecovery(storage: RecoveryStorage): void {
  storage.removeItem(recoveryStorageKey);
}
