import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ProjectHostCommand } from "@clash/shared-types";

export type ProjectHostResponse = Record<string, unknown> & { error?: string };

export type ResolvedProjectHostContext = {
  projectId: string;
  source: "explicit" | "marker" | "env";
  markerPath?: string;
  workspaceRoot?: string;
};

export type ProjectHostConnection = {
  endpoint: string;
  token?: string;
};

export type ProjectHostRequest<T extends ProjectHostResponse = ProjectHostResponse> = {
  command: ProjectHostCommand;
  cwd?: string;
  projectId?: string;
};

export type ProjectHostRequestResult<T extends ProjectHostResponse = ProjectHostResponse> = {
  projectId: string;
  workspaceRoot?: string;
  value: T;
};

export type ProjectHostClient = {
  resolveContext(input?: {
    cwd?: string;
    projectId?: string;
  }): Promise<ResolvedProjectHostContext>;
  request<T extends ProjectHostResponse = ProjectHostResponse>(
    input: ProjectHostRequest<T>,
  ): Promise<ProjectHostRequestResult<T>>;
};

export class ProjectHostHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Project host request failed with HTTP ${status}`);
    this.name = "ProjectHostHttpError";
  }
}

export function projectHostCommandUrl(endpoint: string, projectId: string): string {
  return `${endpoint.replace(/\/+$/, "")}/api/v1/projects/${encodeURIComponent(projectId)}/host-command`;
}

const PROJECT_MARKER = join(".clash", "project.toml");

function cleanProjectId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function markerProjectId(markerPath: string, source: string): string {
  if (!/^schema_version\s*=\s*1\s*$/m.test(source)) {
    throw new Error(`Invalid project marker at ${markerPath}: schema_version must be 1`);
  }
  const match = /^project_id\s*=\s*(.+)$/m.exec(source);
  if (!match) {
    throw new Error(`Invalid project marker at ${markerPath}: project_id is required`);
  }
  try {
    const value = JSON.parse(match[1]!.trim()) as unknown;
    const projectId = cleanProjectId(value);
    if (projectId) return projectId;
  } catch {
    // Use the stable marker error below.
  }
  throw new Error(`Invalid project marker at ${markerPath}: project_id must be a string`);
}

async function findProjectMarker(startCwd: string): Promise<string | undefined> {
  let current = resolve(startCwd);
  while (true) {
    const markerPath = join(current, PROJECT_MARKER);
    try {
      if ((await stat(markerPath)).isFile()) return markerPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** Resolve project identity without importing a particular frontend such as the CLI. */
export async function resolveProjectHostContext(options: {
  cwd?: string;
  projectId?: string;
  env?: Record<string, string | undefined>;
} = {}): Promise<ResolvedProjectHostContext> {
  const env = options.env ?? process.env;
  const cwd = resolve(
    options.cwd?.trim()
      || env.CLASH_WORKSPACE_ROOT?.trim()
      || env.CODEX_WORKSPACE_ROOT?.trim()
      || process.cwd(),
  );
  const explicitProjectId = cleanProjectId(options.projectId);
  const markerPath = await findProjectMarker(cwd);
  const marker = markerPath
    ? markerProjectId(markerPath, await readFile(markerPath, "utf8"))
    : undefined;
  const workspaceRoot = markerPath ? dirname(dirname(markerPath)) : undefined;
  if (explicitProjectId) {
    return {
      projectId: explicitProjectId,
      source: "explicit",
      ...(markerPath ? { markerPath, workspaceRoot } : {}),
    };
  }
  const envProjectId = cleanProjectId(env.CLASH_PROJECT_ID);
  if (marker && envProjectId && marker !== envProjectId) {
    throw new Error(
      `Project context conflict: ${markerPath} points to ${marker}, `
      + `but CLASH_PROJECT_ID is ${envProjectId}. Pass projectId explicitly to choose.`,
    );
  }
  if (marker) {
    return {
      projectId: marker,
      source: "marker",
      markerPath,
      workspaceRoot,
    };
  }
  if (envProjectId) return { projectId: envProjectId, source: "env" };
  throw new Error(
    "No Clash project context found. Run clash init, pass projectId, or set CLASH_PROJECT_ID.",
  );
}

/** Neutral local-api client shared by peer frontends such as CLI and MCP. */
export async function sendProjectHostCommand<T extends ProjectHostResponse = ProjectHostResponse>(options: {
  endpoint: string;
  projectId: string;
  command: ProjectHostCommand;
  token?: string;
  fetch?: typeof globalThis.fetch;
}): Promise<T> {
  const response = await (options.fetch ?? globalThis.fetch)(
    projectHostCommandUrl(options.endpoint, options.projectId),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: JSON.stringify(options.command),
    },
  );
  const body = await response.json().catch(() => undefined) as unknown;
  if (!response.ok) throw new ProjectHostHttpError(response.status, body);
  return body as T;
}

/**
 * In-process local-api client for peer frontends (CLI, MCP, Desktop controllers).
 * Endpoint acquisition is injectable so a distribution can ensure its self-host
 * without coupling this neutral client to a particular lifecycle owner.
 */
export function createProjectHostClient(options: {
  endpoint?: string;
  token?: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  resolveConnection?: () => Promise<ProjectHostConnection>;
} = {}): ProjectHostClient {
  const env = options.env ?? process.env;
  const connection = async (): Promise<ProjectHostConnection> => {
    if (options.resolveConnection) return options.resolveConnection();
    return {
      endpoint: options.endpoint?.trim()
        || env.CLASH_API_URL?.trim()
        || "http://127.0.0.1:8789",
      ...(options.token?.trim() || env.CLASH_API_KEY?.trim()
        ? { token: options.token?.trim() || env.CLASH_API_KEY?.trim() }
        : {}),
    };
  };
  return {
    resolveContext(input = {}) {
      return resolveProjectHostContext({
        cwd: input.cwd,
        projectId: input.projectId,
        env,
      });
    },
    async request<T extends ProjectHostResponse = ProjectHostResponse>(
      input: ProjectHostRequest<T>,
    ): Promise<ProjectHostRequestResult<T>> {
      const context = await this.resolveContext(input);
      const target = await connection();
      const value = await sendProjectHostCommand<T>({
        endpoint: target.endpoint,
        projectId: context.projectId,
        command: input.command,
        token: target.token,
        fetch: options.fetch,
      });
      return {
        projectId: context.projectId,
        ...(context.workspaceRoot ? { workspaceRoot: context.workspaceRoot } : {}),
        value,
      };
    },
  };
}
