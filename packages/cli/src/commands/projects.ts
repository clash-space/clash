import { Command } from "commander";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildProjectStatus as buildSharedProjectStatus,
  projectWorkspaceId,
  type ProjectStatus as SharedProjectStatus,
} from "@clash/shared-runtime";
import { apiJson } from "../lib/api";
import { requireDestructiveConfirmation } from "../lib/destructive-guardrails";
import { resolveClashRoot } from "../lib/clash-home";
import { readProductReplicationState } from "../lib/product-replication-state";
import { isJsonMode, printJson, printTable } from "../lib/output";
import {
  readProjectMarker,
  resolveProjectContext,
  writeProjectMarker,
  type ResolvedProjectContext,
  type ProjectMarker,
} from "../lib/project-context";

export type ProjectStatus = SharedProjectStatus;

interface ProjectRecoveryPolicy {
  cloudStateMutated?: boolean;
  requiresCloudConflictReview?: boolean;
}

function projectWriteHeaders(options: {
  ifMatch?: string;
  force?: boolean;
} = {}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (process.env.CLASH_AGENT_MEMBER_ID?.trim()) {
    headers["x-clash-client-type"] = "agent";
  }
  if (options.ifMatch?.trim()) {
    headers["x-clash-if-match"] = options.ifMatch.trim();
  }
  if (options.force === true) {
    headers["x-clash-force"] = "true";
  }
  return headers;
}

function projectRecoveryPolicyHint(policy?: ProjectRecoveryPolicy): string {
  if (!policy?.requiresCloudConflictReview) {
    return "";
  }
  if (policy.cloudStateMutated === false) {
    return " (local replica only; cloud conflict review required)";
  }
  return " (cloud conflict review required)";
}

export async function linkProject(
  projectId: string,
  options: { cwd?: string } = {},
): Promise<string> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const canonicalProjectId = projectId.trim();
  return writeProjectMarker(cwd, {
    schemaVersion: 1,
    projectId: canonicalProjectId,
    workspaceId: projectWorkspaceId("external", canonicalProjectId, cwd),
    store: "external",
  });
}

export async function initProject(options: {
  cwd?: string;
  projectId?: string;
} = {}): Promise<{ projectId: string; markerPath: string; workspaceId: string }> {
  const projectId = options.projectId?.trim() || `local_${randomUUID()}`;
  const cwd = resolve(options.cwd ?? process.cwd());
  const workspaceId = projectWorkspaceId("managed", projectId, cwd);
  const markerPath = await writeProjectMarker(cwd, {
    schemaVersion: 1,
    projectId,
    workspaceId,
    store: "managed",
  });
  return { projectId, markerPath, workspaceId };
}

export async function resolveProjectStatus(options: {
  project?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  clashRoot?: string;
  replicationState?: Record<string, unknown> | null;
} = {}): Promise<ProjectStatus> {
  const env = options.env ?? process.env;
  const cwd = resolve(options.cwd ?? process.cwd());
  const clashRoot = options.clashRoot ?? (
    options.homeDir ? join(options.homeDir, ".clash") : resolveClashRoot(env)
  );
  const context = await resolveProjectContext({
    project: options.project,
    cwd,
    env,
  });
  let marker: ProjectMarker | null = null;
  if (context.markerPath) {
    const candidate = await readProjectMarker(context.markerPath);
    marker = candidate.projectId === context.projectId ? candidate : null;
  }
  const replicationState = options.replicationState === undefined
    ? readProductReplicationState({
        localApiDataDir: join(clashRoot, "local-api"),
        env,
      })
    : options.replicationState;
  return buildProjectStatus(context, {
    marker,
    homeDir: options.homeDir,
    clashRoot,
    currentWorkingDirectory: cwd,
    replicationState,
  });
}

export function buildProjectStatus(
  context: ResolvedProjectContext,
  options: {
    marker?: ProjectMarker | null;
    homeDir?: string;
    clashRoot?: string;
    currentWorkingDirectory?: string;
    replicationState?: Record<string, unknown> | null;
  } = {},
): ProjectStatus {
  const clashRoot = options.clashRoot ?? join(options.homeDir ?? homedir(), ".clash");
  return buildSharedProjectStatus(context, {
    marker: options.marker,
    replicationState: options.replicationState,
    clashRoot,
    currentWorkingDirectory: options.currentWorkingDirectory,
  });
}

export const initCommand = new Command("init")
  .description("Initialize a local Clash project marker in this directory")
  .option("--project <id>", "Use an existing project id instead of generating a local id")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const result = await initProject({ projectId: options.project });
    if (isJsonMode(options)) {
      printJson(result);
    } else {
      console.log(`Initialized Clash project: ${result.projectId}`);
      console.log(`Marker: ${result.markerPath}`);
    }
  });

export const projectsCommand = new Command("projects")
  .alias("project")
  .description("Manage projects");

projectsCommand
  .command("link")
  .description("Link this directory to a Clash project")
  .argument("<projectId>", "Project ID")
  .option("--json", "Output as JSON")
  .action(async (projectId, options) => {
    const markerPath = await linkProject(projectId);
    const result = { projectId, markerPath };
    if (isJsonMode(options)) {
      printJson(result);
    } else {
      console.log(`Linked Clash project: ${projectId}`);
      console.log(`Marker: ${markerPath}`);
    }
  });

projectsCommand
  .command("status")
  .description("Show the resolved Clash project context")
  .option("--project <id>", "Project ID")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    let status: ProjectStatus;
    try {
      status = await resolveProjectStatus({ project: options.project });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(2);
    }

    if (isJsonMode(options)) {
      printJson(status);
      return;
    }

    console.log(`Project:      ${status.projectId}`);
    console.log(`Source:       ${status.source}`);
    console.log(`Replica:      ${status.mode}`);
    console.log(`Sync:         ${status.syncMode}`);
    console.log(`Marker:       ${status.markerPath ?? "(none)"}`);
    console.log(`Clash home:   ${status.clashHome}`);
    console.log(`Workspace:    ${status.projectWorkspaceRoot}`);
    console.log(`Local API:    ${status.localApiDataDir}`);
    console.log(`Projections:  ${status.roots.projections}`);
    console.log(`Drafts:       ${status.roots.drafts}`);
    console.log(`Loro replica: ${status.loro.replicaRoot}`);
  });

projectsCommand
  .command("list")
  .description("List your projects")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const data = await apiJson<{ projects: any[] }>("/api/v1/projects");

    if (isJsonMode(options)) {
      printJson(data.projects);
    } else {
      printTable(data.projects, [
        { key: "id", label: "ID", width: 38 },
        { key: "name", label: "Name", width: 30 },
        { key: "created_at", label: "Created", width: 12 },
      ]);
    }
  });

projectsCommand
  .command("create")
  .description("Create a new project")
  .requiredOption("--name <name>", "Project name")
  .option("--description <desc>", "Project description")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const data = await apiJson<{ id: string; name: string }>(
      "/api/v1/projects",
      {
        method: "POST",
        body: JSON.stringify({
          name: options.name,
          description: options.description,
        }),
      }
    );

    if (isJsonMode(options)) {
      printJson(data);
    } else {
      console.log(`Created project: ${data.id} (${data.name})`);
    }
  });

projectsCommand
  .command("get")
  .description("Get project details")
  .requiredOption("--id <id>", "Project ID")
  .option("--include-deleted", "Include a soft-deleted local recovery point")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const query = options.includeDeleted === true ? "?includeDeleted=true" : "";
    const data = await apiJson<{
      id: string;
      name: string;
      description?: string;
      created_at: string;
      deletedAt?: string;
      readToken?: string;
    }>(
      `/api/v1/projects/${encodeURIComponent(options.id)}${query}`
    );

    if (isJsonMode(options)) {
      printJson(data);
    } else {
      console.log(`ID:          ${data.id}`);
      console.log(`Name:        ${data.name}`);
      console.log(`Description: ${data.description ?? "(none)"}`);
      console.log(`Created:     ${data.created_at}`);
      if (data.deletedAt) console.log(`Deleted:     ${data.deletedAt}`);
      if (data.readToken) console.log(`Read token:  ${data.readToken}`);
    }
  });

projectsCommand
  .command("delete")
  .description("Delete a project")
  .requiredOption("--id <id>", "Project ID")
  .option("--yes", "Confirm deletion without an interactive prompt")
  .option("--if-match <readToken>", "Require the project read token from `clash project get --json` before deleting")
  .option("--force", "Bypass the agent read-token check")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const confirmation = requireDestructiveConfirmation(
      options,
      `project ${options.id}`,
    );
    if (!confirmation.ok) {
      console.error(`Error: ${confirmation.error}`);
      process.exit(1);
    }

    const deleted = await apiJson<{
      deleted: boolean;
      recoverable?: boolean;
      id?: string;
      recoveryPolicy?: ProjectRecoveryPolicy;
    }>(`/api/v1/projects/${encodeURIComponent(options.id)}`, {
      method: "DELETE",
      headers: projectWriteHeaders({
        ifMatch: options.ifMatch,
        force: options.force === true,
      }),
    });
    const deletedId = deleted.id ?? options.id;
    const recoveryHint = deleted.recoverable
      ? ` (recoverable; run clash project restore ${deletedId} to undo)`
      : "";
    const policyHint = projectRecoveryPolicyHint(deleted.recoveryPolicy);
    if (isJsonMode(options)) {
      printJson(deleted);
    } else {
      console.log(`Deleted project: ${deletedId}${recoveryHint}${policyHint}`);
    }
  });

projectsCommand
  .command("restore")
  .description("Restore a soft-deleted local project")
  .argument("<projectId>", "Project ID")
  .option("--if-match <readToken>", "Require the deleted project read token from `clash project get --include-deleted --json` before restoring")
  .option("--force", "Bypass the agent read-token check")
  .option("--json", "Output as JSON")
  .action(async (projectId, options) => {
    const restored = await apiJson<{
      restored: boolean;
      id: string;
      recoveryPolicy?: ProjectRecoveryPolicy;
    }>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/restore`,
      {
        method: "POST",
        headers: projectWriteHeaders({
          ifMatch: options.ifMatch,
          force: options.force === true,
        }),
      },
    );

    if (isJsonMode(options)) {
      printJson(restored);
    } else {
      console.log(
        `Restored project: ${restored.id}${projectRecoveryPolicyHint(restored.recoveryPolicy)}`,
      );
    }
  });

projectsCommand
  .command("purge")
  .description("Permanently purge a soft-deleted local project recovery point")
  .argument("<projectId>", "Project ID")
  .option("--yes", "Confirm permanent purge without an interactive prompt")
  .option("--if-match <readToken>", "Require the deleted project read token from `clash project get --include-deleted --json` before purging")
  .option("--force", "Bypass the delayed purge window and agent read-token check")
  .option("--json", "Output as JSON")
  .action(async (projectId, options) => {
    const confirmation = requireDestructiveConfirmation(
      options,
      `project recovery point ${projectId}`,
    );
    if (!confirmation.ok) {
      console.error(`Error: ${confirmation.error}`);
      process.exit(1);
    }

    const purged = await apiJson<{
      purged: boolean;
      id: string;
      recoverable?: boolean;
      purgeAfter?: string;
      removed?: Record<string, number>;
      recoveryPolicy?: ProjectRecoveryPolicy;
    }>(`/api/v1/projects/${encodeURIComponent(projectId)}/purge`, {
      method: "DELETE",
      headers: projectWriteHeaders({
        ifMatch: options.ifMatch,
        force: options.force === true,
      }),
      body: JSON.stringify({ confirm: "purge" }),
    });

    if (isJsonMode(options)) {
      printJson(purged);
    } else {
      const removed = purged.removed
        ? ` (${Object.entries(purged.removed)
          .filter(([, count]) => count > 0)
          .map(([key, count]) => `${key}: ${count}`)
          .join(", ")})`
        : "";
      const policyHint = projectRecoveryPolicyHint(purged.recoveryPolicy);
      console.log(`Purged project recovery point: ${purged.id}${removed}${policyHint}`);
    }
  });
