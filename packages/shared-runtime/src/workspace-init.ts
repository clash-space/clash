import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { projectWorkspaceId } from "./project-status.js";

export type ClashWorkspaceInitialization = {
  projectId: string;
  markerPath: string;
  workspaceId: string;
  reused: boolean;
};

function markerString(markerPath: string, source: string, key: string): string {
  const match = new RegExp(`^${key}\\s*=\\s*(.+)$`, "m").exec(source);
  if (!match) throw new Error(`Invalid project marker at ${markerPath}: ${key} is required`);
  try {
    const value = JSON.parse(match[1]!.trim()) as unknown;
    if (typeof value === "string" && value.trim()) return value.trim();
  } catch {
    // Fall through to the stable marker error below.
  }
  throw new Error(`Invalid project marker at ${markerPath}: ${key} must be a string`);
}

async function existingInitialization(
  markerPath: string,
  requestedProjectId: string | undefined,
): Promise<ClashWorkspaceInitialization | undefined> {
  let source: string;
  try {
    source = await readFile(markerPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!/^schema_version\s*=\s*1\s*$/m.test(source)) {
    throw new Error(`Invalid project marker at ${markerPath}: schema_version must be 1`);
  }
  const projectId = markerString(markerPath, source, "project_id");
  const workspaceId = markerString(markerPath, source, "workspace_id");
  if (requestedProjectId && requestedProjectId !== projectId) {
    throw new Error(
      `Workspace is already bound to project ${projectId}; refusing to rebind it to ${requestedProjectId}`,
    );
  }
  return { projectId, markerPath, workspaceId, reused: true };
}

export async function initializeClashWorkspace(options: {
  cwd?: string;
  projectId?: string;
} = {}): Promise<ClashWorkspaceInitialization> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const markerPath = join(cwd, ".clash", "project.toml");
  const requestedProjectId = options.projectId?.trim() || undefined;
  const existing = await existingInitialization(markerPath, requestedProjectId);
  if (existing) return existing;

  const projectId = requestedProjectId ?? `local_${randomUUID()}`;
  const workspaceId = projectWorkspaceId("managed", projectId, cwd);
  const marker = [
    "schema_version = 1",
    `project_id = ${JSON.stringify(projectId)}`,
    `workspace_id = ${JSON.stringify(workspaceId)}`,
    'store = "managed"',
    "",
  ].join("\n");
  await mkdir(dirname(markerPath), { recursive: true });
  try {
    await writeFile(markerPath, marker, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const raced = await existingInitialization(markerPath, requestedProjectId);
    if (raced) return raced;
    throw error;
  }
  return { projectId, markerPath, workspaceId, reused: false };
}
