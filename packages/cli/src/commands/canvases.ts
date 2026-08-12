import { Command } from "commander";
import { isJsonMode, printJson } from "../lib/output";
import { sendProjectCommand } from "../lib/project-host-client";
import { resolveProjectContext } from "../lib/project-context";
import {
  forgetWorktreeObservation,
  recordWorktreeObservation,
  requireWorktreeObservation,
} from "../lib/worktree-observations";
import { requireDestructiveConfirmation } from "../lib/destructive-guardrails";
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
    const result = await sendProjectCommand<CanvasWorkspaceResult>(context.projectId, {
      action: "list_canvases",
    });
    if (result.error) throw new Error(result.error);
    const canvases = result.canvases ?? [];
    const versions = result.versions ?? {};
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
    const payload = await sendProjectCommand<Record<string, unknown>>(context.projectId, {
      action: "create_canvas",
      canvasId: options.id,
      name: options.name,
    });
    if (payload.error) throw new Error(String(payload.error));
    const canvas = payload.canvas as { id: string; name: string; position: number };
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
    const payload = await sendProjectCommand<Record<string, unknown>>(context.projectId, {
      action: "rename_canvas",
      canvasId: options.canvas,
      name: options.name,
      actorClientType: resolveCanvasPresenceOptions().clientType,
      observedVersion,
      ifMatch: observedVersion,
    });
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
    const payload = await sendProjectCommand<Record<string, unknown>>(context.projectId, {
      action: "delete_canvas",
      canvasId: options.canvas,
      actorClientType: resolveCanvasPresenceOptions().clientType,
      observedVersion,
      ifMatch: observedVersion,
    });
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
