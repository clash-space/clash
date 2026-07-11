import { Command } from "commander";
import WebSocket from "ws";
import { LoroSyncClient, projectCanvasReadToken } from "@clash/shared-types";
import { requireApiKey, getServerUrl } from "../lib/config";
import { isJsonMode, printJson } from "../lib/output";
import { isDaemonRunning, sendCommand } from "../lib/daemon";
import { resolveProjectContext } from "../lib/project-context";
import {
  forgetWorktreeObservation,
  recordWorktreeObservation,
  requireWorktreeObservation,
} from "../lib/worktree-observations";
import { requireDestructiveConfirmation } from "../lib/destructive-guardrails";
import { assertAgentHostWritePath } from "../lib/agent-host-write";
import { resolveCanvasPresenceOptions } from "./canvas";

type CanvasWorkspaceResult = {
  canvases?: Array<{ id: string; name: string; position: number }>;
  canvas?: { id: string; name: string; position: number };
  versions?: Record<string, string>;
  version?: string;
  readToken?: string;
  deleted?: boolean;
  canvasId?: string;
  error?: string;
};

async function connectToProject(projectId: string): Promise<LoroSyncClient> {
  const client = new LoroSyncClient({
    serverUrl: getServerUrl().replace(/^http/, "ws"),
    projectId,
    token: requireApiKey(),
    ...resolveCanvasPresenceOptions(),
    WebSocket: WebSocket as any,
  });
  await client.connect();
  return client;
}

async function resolveContext(project?: string) {
  return resolveProjectContext({ project });
}

function isAgent(): boolean {
  return resolveCanvasPresenceOptions().clientType === "agent";
}

async function recordCanvasVersions(
  context: Awaited<ReturnType<typeof resolveContext>>,
  versions: Record<string, string>,
): Promise<void> {
  if (!isAgent()) return;
  if (!context.workspaceRoot) {
    throw new Error("Agent reads require a cwd linked through .clash/project.toml.");
  }
  for (const [canvasId, revision] of Object.entries(versions)) {
    await recordWorktreeObservation({
      workspaceRoot: context.workspaceRoot,
      projectId: context.projectId,
      entityKind: "canvas",
      entityId: canvasId,
      revision,
    });
  }
}

async function requireCanvasVersion(
  context: Awaited<ReturnType<typeof resolveContext>>,
  canvasId: string,
): Promise<string | undefined> {
  if (!isAgent()) return undefined;
  if (!context.workspaceRoot) {
    throw new Error("READ_REQUIRED: Run the command from a cwd linked through .clash/project.toml and read the Canvas first.");
  }
  const observed = await requireWorktreeObservation({
    workspaceRoot: context.workspaceRoot,
    projectId: context.projectId,
    entityKind: "canvas",
    entityId: canvasId,
  });
  if (!observed.ok) throw new Error(`${observed.code}: ${observed.error}`);
  return observed.revision;
}

export const canvasesCommand = new Command("canvases")
  .description("Manage the concrete Canvases inside a Project");

canvasesCommand
  .command("list")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const context = await resolveContext(options.project);
    let canvases: Array<{ id: string; name: string; position: number }>;
    let versions: Record<string, string>;
    if (isDaemonRunning(context.projectId)) {
      const result = await sendCommand(context.projectId, {
        action: "list_canvases",
      }) as CanvasWorkspaceResult;
      if (result.error) throw new Error(result.error);
      canvases = result.canvases ?? [];
      versions = result.versions ?? {};
    } else {
      const client = await connectToProject(context.projectId);
      try {
        canvases = client.listCanvases();
        versions = Object.fromEntries(
          canvases.map((canvas) => [canvas.id, projectCanvasReadToken(canvas)]),
        );
      } finally {
        await client.disconnect();
      }
    }
    await recordCanvasVersions(context, versions);
    if (isJsonMode(options)) printJson(canvases);
    else for (const canvas of canvases) console.log(`${canvas.id}  ${canvas.name}`);
  });

canvasesCommand
  .command("create")
  .requiredOption("--id <id>", "Project-scoped Canvas ID")
  .requiredOption("--name <name>", "Canvas name")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const context = await resolveContext(options.project);
    let payload: Record<string, unknown>;
    if (isDaemonRunning(context.projectId)) {
      payload = await sendCommand(context.projectId, {
        action: "create_canvas",
        canvasId: options.id,
        name: options.name,
      }) as Record<string, unknown>;
    } else {
      const client = await connectToProject(context.projectId);
      try {
        const result = client.createCanvas({ id: options.id, name: options.name });
        payload = result.ok ? { canvas: result.canvas } : { error: result.error };
      } finally {
        await client.disconnect();
      }
    }
    if (payload.error) throw new Error(String(payload.error));
    const canvas = payload.canvas as { id: string; name: string; position: number };
    const nextObservation = typeof payload.readToken === "string"
      ? payload.readToken
      : typeof payload.version === "string"
        ? payload.version
        : projectCanvasReadToken(canvas);
    if (isAgent() && context.workspaceRoot) {
      await recordWorktreeObservation({
        workspaceRoot: context.workspaceRoot,
        projectId: context.projectId,
        entityKind: "canvas",
        entityId: canvas.id,
        revision: nextObservation,
      });
    }
    if (isJsonMode(options)) printJson(payload.canvas);
    else console.log(`Created Canvas: ${canvas.id}`);
  });

canvasesCommand
  .command("rename")
  .requiredOption("--canvas <id>", "Canvas ID")
  .requiredOption("--name <name>", "New Canvas name")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const context = await resolveContext(options.project);
    const observedVersion = await requireCanvasVersion(context, options.canvas);
    let payload: Record<string, unknown>;
    if (isDaemonRunning(context.projectId)) {
      payload = await sendCommand(context.projectId, {
        action: "rename_canvas",
        canvasId: options.canvas,
        name: options.name,
        actorClientType: resolveCanvasPresenceOptions().clientType,
        observedVersion,
        ifMatch: observedVersion,
      }) as Record<string, unknown>;
    } else {
      const hostWrite = assertAgentHostWritePath({
        actorClientType: resolveCanvasPresenceOptions().clientType,
        operation: "Canvas rename",
        readCommand: "clash canvases list --json",
      });
      if (!hostWrite.ok) throw new Error(hostWrite.error);
      const client = await connectToProject(context.projectId);
      try {
        const result = client.renameCanvas(options.canvas, options.name);
        payload = result.ok
          ? { canvas: result.canvas, version: projectCanvasReadToken(result.canvas) }
          : { error: result.error };
      } finally {
        await client.disconnect();
      }
    }
    if (payload.error) throw new Error(String(payload.error));
    const nextObservation = typeof payload.readToken === "string"
      ? payload.readToken
      : typeof payload.version === "string"
        ? payload.version
        : undefined;
    if (isAgent() && context.workspaceRoot && nextObservation) {
      await recordWorktreeObservation({
        workspaceRoot: context.workspaceRoot,
        projectId: context.projectId,
        entityKind: "canvas",
        entityId: options.canvas,
        revision: nextObservation,
      });
    }
    if (isJsonMode(options)) printJson(payload.canvas);
    else console.log(`Renamed Canvas: ${options.canvas}`);
  });

canvasesCommand
  .command("delete")
  .requiredOption("--canvas <id>", "Canvas ID")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--yes", "Confirm deletion without an interactive prompt")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const confirmation = requireDestructiveConfirmation(options, `Canvas ${options.canvas}`);
    if (!confirmation.ok) throw new Error(confirmation.error);
    const context = await resolveContext(options.project);
    const observedVersion = await requireCanvasVersion(context, options.canvas);
    let payload: Record<string, unknown>;
    if (isDaemonRunning(context.projectId)) {
      payload = await sendCommand(context.projectId, {
        action: "delete_canvas",
        canvasId: options.canvas,
        actorClientType: resolveCanvasPresenceOptions().clientType,
        observedVersion,
        ifMatch: observedVersion,
      }) as Record<string, unknown>;
    } else {
      const hostWrite = assertAgentHostWritePath({
        actorClientType: resolveCanvasPresenceOptions().clientType,
        operation: "Canvas delete",
        readCommand: "clash canvases list --json",
      });
      if (!hostWrite.ok) throw new Error(hostWrite.error);
      const client = await connectToProject(context.projectId);
      try {
        const result = client.deleteCanvas(options.canvas);
        payload = result.ok ? { deleted: true, canvasId: result.canvasId } : { error: result.error };
      } finally {
        await client.disconnect();
      }
    }
    if (payload.error) throw new Error(String(payload.error));
    if (isAgent() && context.workspaceRoot) {
      await forgetWorktreeObservation({
        workspaceRoot: context.workspaceRoot,
        projectId: context.projectId,
        entityKind: "canvas",
        entityId: options.canvas,
      });
    }
    if (isJsonMode(options)) printJson(payload);
    else console.log(`Deleted Canvas: ${options.canvas}`);
  });
