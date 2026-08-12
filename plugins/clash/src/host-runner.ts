import {
  createProjectHostClient,
  type ProjectHostClient,
  type ProjectHostConnection,
} from "@clash/shared-runtime/project-host-client";
import {
  createPluginHostManager,
  type PluginHostManager,
} from "./plugin-host.js";

/**
 * Build the MCP peer client for local-api. This module deliberately contains
 * no CLI import and no child-process transport: CLI and MCP share the typed
 * ProjectHost client, not each other's presentation layer.
 */
export function createMcpProjectHostClient(options: {
  runDir?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  hostManager?: Pick<PluginHostManager, "ensureHost">;
} = {}): ProjectHostClient {
  const env = options.env ?? process.env;
  const hostManager = options.hostManager ?? createPluginHostManager({
    runDir: options.runDir,
    env,
  });
  let ensuredConnection: Promise<ProjectHostConnection> | undefined;
  const resolveConnection = async (): Promise<ProjectHostConnection> => {
    const explicitEndpoint = env.CLASH_API_URL?.trim();
    if (explicitEndpoint) {
      return {
        endpoint: explicitEndpoint,
        ...(env.CLASH_API_KEY?.trim() ? { token: env.CLASH_API_KEY.trim() } : {}),
      };
    }
    ensuredConnection ??= hostManager.ensureHost().then((host) => ({
      endpoint: host.endpoint,
    }));
    return ensuredConnection;
  };
  return createProjectHostClient({
    env,
    fetch: options.fetch,
    resolveConnection,
  });
}
