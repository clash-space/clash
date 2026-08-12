import type { ProjectHostCommand } from "@clash/shared-types";
import { sendProjectHostCommand } from "@clash/shared-runtime/project-host-client";
import { getServerUrl, requireApiKey } from "./config";

/**
 * Send a project operation to the local-api authority. The CLI never opens a
 * ProjectRoom socket or owns a replica; local-api serializes the command
 * against its canonical project snapshot.
 */
export function sendProjectCommand<T extends object = Record<string, unknown>>(
  projectId: string,
  command: ProjectHostCommand,
): Promise<T> {
  const endpoint = getServerUrl();
  return sendProjectHostCommand({
    endpoint,
    projectId,
    command,
    token: requireApiKey(endpoint) || undefined,
  }) as Promise<T>;
}
