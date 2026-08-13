import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createProjectHostClient,
  type ProjectHostClient,
  type ProjectHostResponse,
} from "@clash/shared-runtime/project-host-client";
import type { ProjectHostCommand } from "@clash/shared-types";

export type ProductHostReady = {
  projectId: string;
  apiUrl: string;
};

export type ProductHostContext = {
  client: ProjectHostClient;
  ready: ProductHostReady;
  workspace: string;
};

export function createReadbackHostClient(
  ready: ProductHostReady,
): ProjectHostClient {
  return createProjectHostClient({
    endpoint: ready.apiUrl,
    fetch: (request, init) =>
      fetch(request, { ...init, signal: AbortSignal.timeout(15_000) }),
  });
}

export function productHostContext(input: {
  ready: ProductHostReady;
  workspace: string;
}): ProductHostContext {
  return {
    ...input,
    client: createReadbackHostClient(input.ready),
  };
}

export async function requestProjectHost<T extends ProjectHostResponse>(
  input: ProductHostContext & { command: ProjectHostCommand },
): Promise<T> {
  const response = await input.client.request<T>({
    cwd: input.workspace,
    projectId: input.ready.projectId,
    command: input.command,
  });
  if (response.projectId !== input.ready.projectId) {
    throw new Error("Project Host readback resolved a different Project");
  }
  if (response.value.error) throw new Error(response.value.error);
  return response.value;
}

export async function assertProjectHostReady(
  input: ProductHostContext,
): Promise<void> {
  const response = await requestProjectHost<
    { pong?: unknown } & ProjectHostResponse
  >({
    ...input,
    command: { action: "ping" },
  });
  if (response.pong !== true) {
    throw new Error("Clash Project Host did not answer ping");
  }
}

export async function assertWorkspaceProject(
  workspace: string,
  projectId: string,
): Promise<void> {
  const marker = await readFile(
    join(workspace, ".clash", "project.toml"),
    "utf8",
  );
  const markerProjectId = /^project_id\s*=\s*"([^"]+)"/mu.exec(marker)?.[1];
  if (markerProjectId !== projectId) {
    throw new Error(
      "Workspace project marker does not match the live Project Host",
    );
  }
}
