import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface ProjectMarker {
  schemaVersion: 1;
  projectId: string;
  workspaceId?: string;
  store?: string;
  sync?: Record<string, unknown>;
}

export interface ResolvedProjectContext {
  projectId: string;
  source: "explicit" | "marker" | "env";
  markerPath?: string;
}

const MARKER_PATH = join(".clash", "project.toml");

export function projectMarkerPath(cwd: string): string {
  return join(cwd, MARKER_PATH);
}

export async function writeProjectMarker(
  cwd: string,
  marker: ProjectMarker,
): Promise<string> {
  const projectId = cleanProjectId(marker.projectId);
  if (!projectId) {
    throw new Error("Project id is required to write .clash/project.toml.");
  }

  const markerPath = projectMarkerPath(cwd);
  const normalized: ProjectMarker = {
    ...marker,
    schemaVersion: 1,
    projectId,
  };
  await mkdir(dirname(markerPath), { recursive: true });
  await writeFile(markerPath, serializeProjectMarkerToml(normalized), "utf-8");
  return markerPath;
}

export async function readProjectMarker(markerPath: string): Promise<ProjectMarker> {
  const text = await readFile(markerPath, "utf-8");
  const marker = parseProjectMarkerToml(markerPath, text);

  const projectId = cleanProjectId(marker.projectId);
  if (!projectId) {
    throw new Error(`Invalid project marker at ${markerPath}: projectId is required.`);
  }

  return { ...marker, schemaVersion: 1, projectId };
}

function parseProjectMarkerToml(markerPath: string, text: string): ProjectMarker {
  const root: Record<string, unknown> = {};
  const sync: Record<string, unknown> = {};
  const syncCapabilities: Record<string, unknown> = {};
  let section: "root" | "sync" | "sync.capabilities" = "root";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "[sync]") {
      section = "sync";
      continue;
    }
    if (line === "[sync.capabilities]") {
      section = "sync.capabilities";
      continue;
    }
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!match) {
      throw new Error(`Invalid project marker at ${markerPath}: unsupported TOML line "${line}".`);
    }
    const key = match[1];
    const value = parseTomlScalar(markerPath, match[2]);
    if (section === "sync") sync[key] = value;
    else if (section === "sync.capabilities") syncCapabilities[key] = value;
    else root[key] = value;
  }

  const schemaVersion = root.schema_version ?? root.schemaVersion;
  if (schemaVersion !== 1) {
    throw new Error(`Invalid project marker at ${markerPath}: schema_version must be 1.`);
  }

  return {
    schemaVersion: 1,
    projectId: stringValue(root.project_id ?? root.projectId) ?? "",
    ...(stringValue(root.workspace_id ?? root.workspaceId)
      ? { workspaceId: stringValue(root.workspace_id ?? root.workspaceId) }
      : {}),
    ...(stringValue(root.store) ? { store: stringValue(root.store) } : {}),
    ...(Object.keys(sync).length > 0 || Object.keys(syncCapabilities).length > 0
      ? { sync: { ...sync, ...(Object.keys(syncCapabilities).length > 0 ? { capabilities: syncCapabilities } : {}) } }
      : {}),
  };
}

function parseTomlScalar(markerPath: string, raw: string): string | number | boolean {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch (error) {
      throw new Error(`Invalid project marker at ${markerPath}: bad string value: ${message(error)}`);
    }
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  throw new Error(`Invalid project marker at ${markerPath}: unsupported value "${value}".`);
}

function serializeProjectMarkerToml(marker: ProjectMarker): string {
  const lines = [
    `schema_version = ${marker.schemaVersion}`,
    `project_id = ${tomlString(marker.projectId)}`,
  ];
  if (marker.workspaceId) lines.push(`workspace_id = ${tomlString(marker.workspaceId)}`);
  if (marker.store) lines.push(`store = ${tomlString(marker.store)}`);
  if (marker.sync && Object.keys(marker.sync).length > 0) {
    const syncCapabilities = recordValue(marker.sync.capabilities);
    const syncEntries = Object.entries(marker.sync).filter(
      ([key]) => !(key === "capabilities" && syncCapabilities),
    );
    if (syncEntries.length > 0) {
      lines.push("", "[sync]");
    }
    for (const [key, value] of syncEntries) {
      lines.push(`${tomlKey(key)} = ${tomlValue(value)}`);
    }
    if (syncCapabilities && Object.keys(syncCapabilities).length > 0) {
      lines.push("", "[sync.capabilities]");
      for (const [key, value] of Object.entries(syncCapabilities)) {
        lines.push(`${tomlKey(key)} = ${tomlValue(value)}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function tomlKey(key: string): string {
  if (/^[A-Za-z0-9_-]+$/.test(key)) return key;
  return tomlString(key);
}

function tomlValue(value: unknown): string {
  if (typeof value === "string") return tomlString(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return tomlString(JSON.stringify(value));
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function findProjectMarker(startCwd: string): Promise<string | undefined> {
  let current = resolve(startCwd);
  while (true) {
    const candidate = projectMarkerPath(current);
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export async function resolveProjectContext(options: {
  project?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
} = {}): Promise<ResolvedProjectContext> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const explicitProjectId = cleanProjectId(options.project);
  const markerPath = await findProjectMarker(cwd);

  if (explicitProjectId) {
    return {
      projectId: explicitProjectId,
      source: "explicit",
      ...(markerPath ? { markerPath } : {}),
    };
  }

  const marker = markerPath ? await readProjectMarker(markerPath) : undefined;
  const envProjectId = cleanProjectId(env.CLASH_PROJECT_ID);

  if (marker && envProjectId && marker.projectId !== envProjectId) {
    throw new Error(
      `Project context conflict: ${markerPath} points to ${marker.projectId}, ` +
        `but CLASH_PROJECT_ID is ${envProjectId}. Pass --project <id> to choose explicitly.`,
    );
  }

  if (marker) {
    return { projectId: marker.projectId, source: "marker", markerPath };
  }
  if (envProjectId) {
    return { projectId: envProjectId, source: "env" };
  }

  throw new Error(
    "No Clash project context found. Run clash init, run clash project link <projectId>, " +
      "pass --project <id>, or set CLASH_PROJECT_ID.",
  );
}

function cleanProjectId(projectId: unknown): string | undefined {
  if (typeof projectId !== "string") return undefined;
  const trimmed = projectId.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
