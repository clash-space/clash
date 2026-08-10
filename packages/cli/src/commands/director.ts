import { Command, Option } from "commander";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import WebSocket from "ws";
import {
  applyDirectorStageCommand,
  createDefaultDirectorStageState,
  directorDefaultAttachmentOffset,
  LoroSyncClient,
  projectDirectorStageReadToken,
  type DirectorStageCameraPatch,
  type DirectorStageCommand,
  type DirectorStageObject,
  type DirectorStageObjectPatch,
  type ProjectDirectorStage,
} from "@clash/shared-types";
import { requireApiKey, getServerUrl } from "../lib/config";
import { isJsonMode, printJson, printTable } from "../lib/output";
import { isDaemonRunning, sendCommand } from "../lib/daemon";
import { assertAgentHostWritePath } from "../lib/agent-host-write";
import { type ResolvedProjectContext } from "../lib/project-context";
import {
  recordWorktreeObservation,
  requireWorktreeObservation,
} from "../lib/worktree-observations";
import {
  resolveCanvasPresenceOptions,
  resolveCanvasProjectContext,
} from "./canvas";
import {
  directorStageCanonicalJson,
  directorStageHash,
  parseDirectorStageFileForApply,
  resolveDirectorStageFilePath,
} from "../lib/director-stage-projection";
import {
  recoverStaleProjection,
  staleProjectionRecoveryError,
} from "../lib/stale-projection-recovery";
import { importAssetFile } from "./assets";
import { attachAssetMetadata } from "../lib/attach-asset-metadata";

type DirectorStageWorkspaceResult = {
  stages?: ProjectDirectorStage[];
  stage?: ProjectDirectorStage;
  versions?: Record<string, string>;
  version?: string;
  readToken?: string;
  error?: string;
  code?: string;
};

function isAgentDirectorStageClient(): boolean {
  return resolveCanvasPresenceOptions().clientType === "agent";
}

async function recordDirectorStageObservation(
  context: ResolvedProjectContext,
  stageId: string,
  revision: string,
): Promise<void> {
  if (!isAgentDirectorStageClient()) return;
  if (!context.workspaceRoot) {
    throw new Error("Agent reads require a cwd linked through .clash/project.toml.");
  }
  await recordWorktreeObservation({
    workspaceRoot: context.workspaceRoot,
    projectId: context.projectId,
    entityKind: "director-stage",
    entityId: stageId,
    revision,
  });
}

async function requireDirectorStageObservation(
  context: ResolvedProjectContext,
  stageId: string,
): Promise<string | undefined> {
  if (!isAgentDirectorStageClient()) return undefined;
  if (!context.workspaceRoot) {
    throw new Error(
      "READ_REQUIRED: Run from a cwd linked through .clash/project.toml and read the Director Stage first.",
    );
  }
  const observation = await requireWorktreeObservation({
    workspaceRoot: context.workspaceRoot,
    projectId: context.projectId,
    entityKind: "director-stage",
    entityId: stageId,
  });
  if (!observation.ok) throw new Error(`${observation.code}: ${observation.error}`);
  return observation.revision;
}

function assertDirectorStageHostWrite(operation: string): void {
  const result = assertAgentHostWritePath({
    actorClientType: resolveCanvasPresenceOptions().clientType,
    operation,
    readCommand: "clash director list --json",
  });
  if (!result.ok) throw new Error(result.error);
}

function finiteNumber(value: unknown, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${option} must be a finite number`);
  return parsed;
}


function positiveInteger(value: unknown, option: string): number {
  const parsed = finiteNumber(value, option);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${option} must be a positive integer`);
  return parsed;
}

function booleanValue(value: unknown, option: string): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`${option} must be true or false`);
}

async function connectToProject(projectId: string): Promise<LoroSyncClient> {
  const serverUrl = getServerUrl();
  const client = new LoroSyncClient({
    serverUrl: serverUrl.replace(/^http/, "ws"),
    projectId,
    token: requireApiKey(),
    ...resolveCanvasPresenceOptions(),
    WebSocket: WebSocket as never,
  });
  await client.connect();
  return client;
}

async function listDirectorStages(
  context: ResolvedProjectContext,
): Promise<{ stages: ProjectDirectorStage[]; versions: Record<string, string> }> {
  if (isDaemonRunning(context.projectId)) {
    const result = await sendCommand(context.projectId, {
      action: "list_director_stages",
    }) as DirectorStageWorkspaceResult;
    if (result.error) throw new Error(result.error);
    return { stages: result.stages ?? [], versions: result.versions ?? {} };
  }
  const client = await connectToProject(context.projectId);
  try {
    const stages = client.listDirectorStages();
    return {
      stages,
      versions: Object.fromEntries(
        stages.map((stage) => [stage.id, projectDirectorStageReadToken(stage)]),
      ),
    };
  } finally {
    await client.disconnect();
  }
}

async function readDirectorStage(
  context: ResolvedProjectContext,
  stageId: string,
): Promise<ProjectDirectorStage> {
  const listed = await listDirectorStages(context);
  const stage = listed.stages.find((candidate) => candidate.id === stageId);
  if (!stage) throw new Error(`Director Stage ${stageId} not found`);
  await recordDirectorStageObservation(
    context,
    stage.id,
    listed.versions[stage.id] ?? projectDirectorStageReadToken(stage),
  );
  return stage;
}

async function recoverStaleDirectorStageApply(options: {
  context: ResolvedProjectContext;
  stageId: string;
  editedProjectionPath: string;
}): Promise<never> {
  const listed = await listDirectorStages(options.context);
  const latest = listed.stages.find((candidate) => candidate.id === options.stageId);
  if (!latest) {
    throw new Error(`Director Stage ${options.stageId} not found after the stale write was rejected`);
  }
  const currentObservation = listed.versions[latest.id] ?? projectDirectorStageReadToken(latest);
  const recovery = await recoverStaleProjection({
    workspaceRoot: options.context.workspaceRoot ?? process.cwd(),
    projectId: options.context.projectId,
    entityKind: "director-stage",
    entityId: latest.id,
    currentRevisionId: latest.revisionId,
    currentObservation,
    editedProjectionPath: options.editedProjectionPath,
    latestContent: directorStageCanonicalJson(latest.state),
  });
  throw staleProjectionRecoveryError("Director Stage", recovery);
}

type DirectorCaptureAspectRatio = "16:9" | "9:16" | "4:3" | "3:4" | "1:1";

type DirectorCaptureRenderResult = {
  renderer: { id: string; contractVersion: number };
  stateSha256: string;
  frames: Array<{
    label: string;
    timeSeconds: number;
    aspectRatio: DirectorCaptureAspectRatio;
    activeCameraId?: string;
    width: number;
    height: number;
    mimeType: "image/png";
    dataBase64: string;
    sha256: string;
  }>;
};

type DirectorCaptureStage = Pick<ProjectDirectorStage, "id" | "name" | "revisionId" | "state">;

export type DirectorCaptureReceipt = {
  captured: true;
  stageId: string;
  sourceStageRevisionId: string;
  verifiedStageRevisionId: string;
  renderer: { id: string; contractVersion: number };
  stateSha256: string;
  frames: Array<{
    artifactId: string;
    timeSeconds: number;
    aspectRatio: DirectorCaptureAspectRatio;
    activeCameraId?: string;
    width: number;
    height: number;
    mimeType: "image/png";
    sha256: string;
    path: string;
  }>;
  receiptPath: string;
};

function captureSha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function captureArtifactId(label: string): string {
  const value = label.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`Invalid Director capture label: ${label}`);
  }
  return value;
}

/**
 * Attaches provenance to each captured frame.
 *
 * A generated asset carries its origin as canvas edges to the nodes it referenced. A capture is
 * written as a file, so without this the only record of where it came from is the directory it
 * landed in -- and re-capturing after an edit leaves two images that cannot be told apart. Every
 * fact here was already computed for `capture.json`; attaching it puts provenance where the rest of
 * the product looks for it.
 *
 * Failures are reported, not thrown: the frames are on disk and verified by then, and losing them
 * because bookkeeping failed would be the worse outcome.
 */
async function recordCaptureLineage(options: {
  cwd: string;
  stageId: string;
  sourceStageRevisionId: string;
  renderer: string;
  frames: ReadonlyArray<{ artifactId: string; path: string; sha256: string; timeSeconds: number }>;
}): Promise<{ attached: number; failed: string[] }> {
  const failed: string[] = [];
  let attached = 0;
  for (const frame of options.frames) {
    try {
      const imported = await importAssetFile({ cwd: options.cwd, filePath: frame.path, kind: "image" });
      await attachAssetMetadata({
        cwd: options.cwd,
        assetId: imported.assetId,
        metadataKind: "media.render-lineage",
        producer: "clash:director capture",
        metadata: {
          schemaVersion: 1,
          kind: "media.render-lineage",
          sourceEntityKind: "director-stage",
          sourceEntityId: options.stageId,
          sourceRevisionId: options.sourceStageRevisionId,
          timeSeconds: frame.timeSeconds,
          renderer: options.renderer,
          sourceHash: `sha256:${frame.sha256}`,
        },
      });
      attached += 1;
    } catch (error) {
      failed.push(`${frame.artifactId}: ${(error as Error).message}`);
    }
  }
  return { attached, failed };
}

function resolveCaptureOutputDir(cwd: string, stageId: string, outputDir?: string): string {
  const root = resolve(cwd);
  const target = outputDir?.trim()
    ? resolve(root, outputDir)
    : join(root, "director-stages", captureArtifactId(stageId), "captures");
  const traversal = relative(root, target);
  if (traversal === ".." || traversal.startsWith(`..${sep}`) || isAbsolute(traversal)) {
    throw new Error("Director capture output directory must stay inside the current project cwd");
  }
  return target;
}

function captureAspectRatioAt(
  state: ProjectDirectorStage["state"],
  timeSeconds: number,
  override?: DirectorCaptureAspectRatio,
): DirectorCaptureAspectRatio {
  if (override) return override;
  const duration = state.animation?.durationSeconds;
  const active = [...(state.shotSequence ?? [])]
    .sort((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id))
    .find((shot) => timeSeconds >= shot.startTime && (
      timeSeconds < shot.startTime + shot.durationSeconds ||
      (duration !== undefined && Math.abs(timeSeconds - duration) < 1e-6 &&
        Math.abs(shot.startTime + shot.durationSeconds - duration) < 1e-6)
    ));
  return active?.aspectRatio ?? state.shotSequence?.[0]?.aspectRatio ?? state.shots[0]?.aspectRatio ?? "16:9";
}

function defaultCaptureLabels(count: number): string[] {
  if (count === 3) return ["frame-opening", "frame-action", "frame-closing"];
  return Array.from({ length: count }, (_, index) => `frame-${String(index + 1).padStart(3, "0")}`);
}

async function renderDirectorStageThroughHost(
  request: Record<string, unknown>,
): Promise<DirectorCaptureRenderResult> {
  const serverUrl = getServerUrl();
  const apiKey = requireApiKey(serverUrl);
  const response = await fetch(new URL("/api/v1/local/director-stage/capture", serverUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(request),
  });
  const value = await response.json().catch(() => ({})) as DirectorCaptureRenderResult & { error?: string };
  if (!response.ok) {
    throw new Error(value.error ?? `Director product renderer failed with HTTP ${response.status}`);
  }
  return value;
}

export async function captureDirectorStageWithReadback(options: {
  cwd: string;
  stageId: string;
  times: number[];
  labels?: string[];
  outputDir?: string;
  aspectRatio?: DirectorCaptureAspectRatio;
  longEdge: number;
  readStage: () => Promise<DirectorCaptureStage>;
  render?: (request: Record<string, unknown>) => Promise<DirectorCaptureRenderResult>;
}): Promise<DirectorCaptureReceipt> {
  if (!Array.isArray(options.times) || options.times.length < 1 || options.times.length > 12) {
    throw new Error("Director capture requires between 1 and 12 --time values");
  }
  const times = options.times.map((time) => {
    if (!Number.isFinite(time) || time < 0) {
      throw new Error("Director capture times must be finite non-negative seconds");
    }
    return time;
  });
  const labels = options.labels?.length ? options.labels : defaultCaptureLabels(times.length);
  if (labels.length !== times.length) {
    throw new Error("Director capture --label count must match --time count");
  }
  const artifactIds = labels.map(captureArtifactId);
  if (new Set(artifactIds).size !== artifactIds.length) {
    throw new Error("Director capture labels must be unique");
  }
  if (!Number.isInteger(options.longEdge) || options.longEdge < 256 || options.longEdge > 4096) {
    throw new Error("Director capture --long-edge must be an integer between 256 and 4096");
  }

  const before = await options.readStage();
  if (before.id !== options.stageId) throw new Error(`Director Stage ${options.stageId} not found`);
  const request = {
    state: before.state,
    longEdge: options.longEdge,
    frames: times.map((timeSeconds, index) => ({
      label: artifactIds[index]!,
      timeSeconds,
      aspectRatio: captureAspectRatioAt(before.state, timeSeconds, options.aspectRatio),
    })),
  };
  const rendered = await (options.render ?? renderDirectorStageThroughHost)(request);
  if (rendered.renderer.id !== "clash-director-viewport-webgl") {
    throw new Error(`Unexpected Director renderer: ${rendered.renderer.id}`);
  }
  if (rendered.renderer.contractVersion !== 1) {
    throw new Error(`Unsupported Director renderer contract: ${rendered.renderer.contractVersion}`);
  }
  if (rendered.stateSha256 !== captureSha256(JSON.stringify(before.state))) {
    throw new Error("Director renderer state hash does not match the persisted Stage revision");
  }
  if (rendered.frames.length !== times.length) {
    throw new Error("Director renderer returned an incomplete frame set");
  }
  for (const [index, frame] of rendered.frames.entries()) {
    const expected = request.frames[index]!;
    if (frame.label !== expected.label) {
      throw new Error(`Director renderer changed frame label ${expected.label}`);
    }
    if (frame.timeSeconds !== expected.timeSeconds) {
      throw new Error(`Director renderer changed frame time for ${expected.label}`);
    }
    if (frame.aspectRatio !== expected.aspectRatio) {
      throw new Error(`Director renderer changed frame aspect ratio for ${expected.label}`);
    }
    if (frame.mimeType !== "image/png") {
      throw new Error(`Director renderer returned a non-PNG frame for ${expected.label}`);
    }
    if (!Number.isInteger(frame.width) || frame.width < 1 ||
        !Number.isInteger(frame.height) || frame.height < 1) {
      throw new Error(`Director renderer returned invalid dimensions for ${expected.label}`);
    }
  }

  const after = await options.readStage();
  if (after.revisionId !== before.revisionId) {
    throw new Error(
      `Director Stage ${options.stageId} changed during capture (${before.revisionId} -> ${after.revisionId})`,
    );
  }

  const outputDir = resolveCaptureOutputDir(options.cwd, options.stageId, options.outputDir);
  mkdirSync(outputDir, { recursive: true });
  const frames = rendered.frames.map((frame, index) => {
    const artifactId = artifactIds[index]!;
    const bytes = Buffer.from(frame.dataBase64, "base64");
    if (bytes.length === 0 || captureSha256(bytes) !== frame.sha256) {
      throw new Error(`Director renderer returned invalid bytes for ${artifactId}`);
    }
    const path = join(outputDir, `${artifactId}.png`);
    writeFileSync(path, bytes);
    return {
      artifactId,
      timeSeconds: frame.timeSeconds,
      aspectRatio: frame.aspectRatio,
      ...(frame.activeCameraId ? { activeCameraId: frame.activeCameraId } : {}),
      width: frame.width,
      height: frame.height,
      mimeType: frame.mimeType,
      sha256: frame.sha256,
      path,
    };
  });
  const lineage = await recordCaptureLineage({
    cwd: options.cwd,
    stageId: options.stageId,
    sourceStageRevisionId: before.revisionId,
    renderer: rendered.renderer.id,
    frames,
  });
  if (lineage.failed.length > 0) {
    process.stderr.write(
      `warning: ${lineage.failed.length} capture(s) written without lineage: ${lineage.failed.join("; ")}\n`,
    );
  }

  const receiptPath = join(outputDir, "capture.json");
  const receipt: DirectorCaptureReceipt = {
    captured: true,
    stageId: options.stageId,
    sourceStageRevisionId: before.revisionId,
    verifiedStageRevisionId: after.revisionId,
    renderer: rendered.renderer,
    stateSha256: rendered.stateSha256,
    frames,
    receiptPath,
  };
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return receipt;
}




export const directorCommand = new Command("director")
  .description("Author Project Director Stage scenes through deterministic agent commands and JSON projections");

directorCommand
  .command("list")
  .description("List Project Director Stages and their owners")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    const result = await listDirectorStages(context);
    for (const stage of result.stages) {
      await recordDirectorStageObservation(
        context,
        stage.id,
        result.versions[stage.id] ?? projectDirectorStageReadToken(stage),
      );
    }
    if (isJsonMode(options)) return printJson(result.stages);
    printTable(result.stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      owner: stage.owner.kind === "project" ? "Project" : `Canvas ${stage.owner.canvasId}`,
      objects: stage.state.objects.length,
      cameras: stage.state.cameras.length,
    })), [
      { key: "id", label: "Director Stage", width: 24 },
      { key: "name", label: "Name", width: 28 },
      { key: "owner", label: "Owner", width: 24 },
      { key: "objects", label: "Objects", width: 10 },
      { key: "cameras", label: "Cameras", width: 10 },
    ]);
  });

directorCommand
  .command("create")
  .description("Create a standalone Project Director Stage")
  .requiredOption("--id <id>", "Project-scoped Director Stage ID")
  .requiredOption("--name <name>", "Director Stage name")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    let result: DirectorStageWorkspaceResult;
    if (isDaemonRunning(context.projectId)) {
      result = await sendCommand(context.projectId, {
        action: "create_director_stage",
        stageId: options.id,
        name: options.name,
        state: createDefaultDirectorStageState(),
      }) as DirectorStageWorkspaceResult;
    } else {
      const client = await connectToProject(context.projectId);
      try {
        const created = client.createDirectorStage({
          id: options.id,
          name: options.name,
          state: createDefaultDirectorStageState(),
        });
        result = created.ok
          ? { stage: created.stage, version: projectDirectorStageReadToken(created.stage) }
          : { error: created.error };
      } finally {
        await client.disconnect();
      }
    }
    if (result.error || !result.stage) throw new Error(result.error ?? "Director Stage create failed");
    await recordDirectorStageObservation(
      context,
      result.stage.id,
      result.readToken ?? result.version ?? projectDirectorStageReadToken(result.stage),
    );
    if (isJsonMode(options)) printJson(result.stage);
    else console.log(`Created Director Stage: ${result.stage.id}`);
  });

directorCommand
  .command("attach")
  .description("Attach a standalone Director Stage to one Canvas action node")
  .requiredOption("--stage <id>", "Director Stage ID")
  .requiredOption("--canvas <id>", "Owning Canvas ID")
  .option("--node <id>", "Canvas action node ID")
  .option("--x <number>", "Canvas X position", "0")
  .option("--y <number>", "Canvas Y position", "0")
  .option("--project <id>", "Project ID")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    const observedVersion = await requireDirectorStageObservation(context, options.stage);
    const actionNodeId = options.node?.trim() || `director-stage-${randomUUID().slice(0, 8)}`;
    let result: DirectorStageWorkspaceResult;
    if (isDaemonRunning(context.projectId)) {
      result = await sendCommand(context.projectId, {
        action: "attach_director_stage",
        stageId: options.stage,
        canvasId: options.canvas,
        actionNodeId,
        position: {
          x: finiteNumber(options.x, "--x"),
          y: finiteNumber(options.y, "--y"),
        },
        actorClientType: resolveCanvasPresenceOptions().clientType,
        observedVersion,
        ifMatch: observedVersion,
      }) as DirectorStageWorkspaceResult;
    } else {
      assertDirectorStageHostWrite("Director Stage attach");
      const client = await connectToProject(context.projectId);
      try {
        const attached = client.attachDirectorStage({
          stageId: options.stage,
          canvasId: options.canvas,
          actionNodeId,
          position: {
            x: finiteNumber(options.x, "--x"),
            y: finiteNumber(options.y, "--y"),
          },
        });
        result = attached.ok
          ? { stage: attached.stage, version: projectDirectorStageReadToken(attached.stage) }
          : { error: attached.error };
      } finally {
        await client.disconnect();
      }
    }
    if (result.error || !result.stage) throw new Error(result.error ?? "Director Stage attach failed");
    await recordDirectorStageObservation(
      context,
      result.stage.id,
      result.readToken ?? result.version ?? projectDirectorStageReadToken(result.stage),
    );
    if (isJsonMode(options)) printJson(result.stage);
    else console.log(`Attached Director Stage ${result.stage.id} to Canvas ${options.canvas}`);
  });

directorCommand
  .command("detach")
  .description("Detach a Canvas-owned Director Stage to the Project root")
  .requiredOption("--stage <id>", "Director Stage ID")
  .option("--project <id>", "Project ID")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    const observedVersion = await requireDirectorStageObservation(context, options.stage);
    let result: DirectorStageWorkspaceResult;
    if (isDaemonRunning(context.projectId)) {
      result = await sendCommand(context.projectId, {
        action: "detach_director_stage",
        stageId: options.stage,
        actorClientType: resolveCanvasPresenceOptions().clientType,
        observedVersion,
        ifMatch: observedVersion,
      }) as DirectorStageWorkspaceResult;
    } else {
      assertDirectorStageHostWrite("Director Stage detach");
      const client = await connectToProject(context.projectId);
      try {
        const detached = client.detachDirectorStage(options.stage);
        result = detached.ok
          ? { stage: detached.stage, version: projectDirectorStageReadToken(detached.stage) }
          : { error: detached.error };
      } finally {
        await client.disconnect();
      }
    }
    if (result.error || !result.stage) throw new Error(result.error ?? "Director Stage detach failed");
    await recordDirectorStageObservation(
      context,
      result.stage.id,
      result.readToken ?? result.version ?? projectDirectorStageReadToken(result.stage),
    );
    if (isJsonMode(options)) printJson(result.stage);
    else console.log(`Detached Director Stage: ${result.stage.id}`);
  });

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

directorCommand
  .command("capture")
  .description("Capture exact-time PNG evidence through the daemon-owned DirectorViewport WebGL renderer")
  .requiredOption("--stage <id>", "Director Stage ID")
  .option("--time <seconds>", "Exact Stage time in seconds (repeat for each PNG)", collectOption, [])
  .option("--label <artifact-id>", "Artifact id for each PNG (repeat in --time order)", collectOption, [])
  .option("--output-dir <path>", "Project-relative output directory")
  .addOption(new Option("--aspect-ratio <ratio>", "Override the shot aspect ratio").choices([
    "16:9", "9:16", "4:3", "3:4", "1:1",
  ]))
  .option("--long-edge <pixels>", "Output long edge in pixels", "1920")
  .option("--project <id>", "Project ID")
  .option("--json", "Output the capture and Stage readback receipt as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    const receipt = await captureDirectorStageWithReadback({
      cwd: context.workspaceRoot ?? process.cwd(),
      stageId: options.stage,
      times: (options.time as string[]).map((value) => finiteNumber(value, "--time")),
      labels: options.label as string[],
      outputDir: options.outputDir,
      aspectRatio: options.aspectRatio as DirectorCaptureAspectRatio | undefined,
      longEdge: positiveInteger(options.longEdge, "--long-edge"),
      readStage: () => readDirectorStage(context, options.stage),
    });
    if (isJsonMode(options)) printJson(receipt);
    else process.stderr.write(`captured ${receipt.frames.length} Director PNGs to ${dirname(receipt.receiptPath)}\n`);
  });

directorCommand
  .command("pull")
  .description("Export the current Director Stage revision to JSON")
  .requiredOption("--stage <id>", "Director Stage ID")
  .option("--project <id>", "Project ID")
  .option("--file <path>", "Projection path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    const stage = await readDirectorStage(context, options.stage);
    const filePath = resolveDirectorStageFilePath({
      cwd: process.cwd(),
      stage: stage.id,
      file: options.file,
    });
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, directorStageCanonicalJson(stage.state), "utf8");
    const payload = {
      pulled: true,
      projectId: context.projectId,
      stageId: stage.id,
      revisionId: stage.revisionId,
      owner: stage.owner,
      filePath,
      stageHash: directorStageHash(stage.state),
    };
    if (isJsonMode(options)) printJson(payload);
    else process.stderr.write(`wrote ${filePath}\n`);
  });

directorCommand
  .command("apply")
  .description("Validate a Director Stage JSON projection and advance its revision")
  .requiredOption("--stage <id>", "Director Stage ID")
  .option("--project <id>", "Project ID")
  .option("--file <path>", "Projection path")
  .option("--base-revision <revision>", "Revision the edited projection was based on")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    const filePath = resolveDirectorStageFilePath({
      cwd: process.cwd(),
      stage: options.stage,
      file: options.file,
    });
    const parsed = parseDirectorStageFileForApply(readFileSync(filePath, "utf8"));
    if (!parsed.ok) throw new Error(parsed.error);
    let observedVersion: string | undefined;
    const baseRevisionId = typeof options.baseRevision === "string"
      ? options.baseRevision.trim()
      : "";
    if (baseRevisionId) {
      const listed = await listDirectorStages(context);
      const latest = listed.stages.find((candidate) => candidate.id === options.stage);
      if (!latest) throw new Error(`Director Stage ${options.stage} not found`);
      if (latest.revisionId !== baseRevisionId) {
        await recoverStaleDirectorStageApply({
          context,
          stageId: options.stage,
          editedProjectionPath: filePath,
        });
      }
      observedVersion = listed.versions[latest.id] ?? projectDirectorStageReadToken(latest);
      await recordDirectorStageObservation(context, latest.id, observedVersion);
    } else {
      observedVersion = await requireDirectorStageObservation(context, options.stage);
    }
    let result: DirectorStageWorkspaceResult;
    if (isDaemonRunning(context.projectId)) {
      result = await sendCommand(context.projectId, {
        action: "update_director_stage_state",
        stageId: options.stage,
        state: parsed.state,
        actorClientType: resolveCanvasPresenceOptions().clientType,
        observedVersion,
        ifMatch: observedVersion,
      }) as DirectorStageWorkspaceResult;
    } else {
      assertDirectorStageHostWrite("Director Stage apply");
      const client = await connectToProject(context.projectId);
      try {
        const updated = client.updateDirectorStageState(options.stage, parsed.state);
        result = updated.ok
          ? { stage: updated.stage, version: projectDirectorStageReadToken(updated.stage) }
          : { error: updated.error };
      } finally {
        await client.disconnect();
      }
    }
    if (result.error || !result.stage) {
      if (result.code === "STALE_READ") {
        await recoverStaleDirectorStageApply({
          context,
          stageId: options.stage,
          editedProjectionPath: filePath,
        });
      }
      throw new Error(result.error ?? "Director Stage apply failed");
    }
    await recordDirectorStageObservation(
      context,
      result.stage.id,
      result.readToken ?? result.version ?? projectDirectorStageReadToken(result.stage),
    );
    const payload = {
      applied: true,
      projectId: context.projectId,
      stageId: result.stage.id,
      revisionId: result.stage.revisionId,
      filePath,
      stageHash: directorStageHash(result.stage.state),
    };
    if (isJsonMode(options)) printJson(payload);
    else process.stderr.write(`applied ${filePath} to Director Stage ${result.stage.id}\n`);
  });
