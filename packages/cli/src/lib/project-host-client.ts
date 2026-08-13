import type { ProjectHostCommand } from "@clash/shared-types";
import {
  createProjectAssetHostClient,
  type ProjectAssetHostClient,
} from "@clash/shared-runtime/project-asset-client";
import {
  sendProjectHostCommand,
  type ProjectHostConnection,
} from "@clash/shared-runtime/project-host-client";
import { getServerUrl, requireApiKey } from "./config";

export function resolveCliProjectHostConnection(): ProjectHostConnection {
  const endpoint = getServerUrl();
  const token = requireApiKey(endpoint);
  return {
    endpoint,
    ...(token ? { token } : {}),
  };
}

export function createCliProjectAssetHostClient(options: {
  fetch?: typeof globalThis.fetch;
} = {}): ProjectAssetHostClient {
  return createProjectAssetHostClient({
    resolveConnection: async () => resolveCliProjectHostConnection(),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

/**
 * Send a project operation to the local-api authority. The CLI never opens a
 * ProjectRoom socket or owns a replica; local-api serializes the command
 * against its canonical project snapshot.
 */
export function sendProjectCommand<T extends object = Record<string, unknown>>(
  projectId: string,
  command: ProjectHostCommand,
): Promise<T> {
  const { endpoint, token } = resolveCliProjectHostConnection();
  return sendProjectHostCommand({
    endpoint,
    projectId,
    command,
    token,
  }) as Promise<T>;
}
