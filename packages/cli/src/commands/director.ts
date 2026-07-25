import { Command, Option } from "commander";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
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

function optionalFiniteNumber(value: unknown, option: string): number | undefined {
  return value === undefined ? undefined : finiteNumber(value, option);
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

async function updateStageWithCommand(
  context: ResolvedProjectContext,
  stageId: string,
  command: DirectorStageCommand,
): Promise<ProjectDirectorStage> {
  const stage = await readDirectorStage(context, stageId);
  const reduced = applyDirectorStageCommand(stage.state, command);
  if (!reduced.ok) throw new Error(reduced.error);
  const observedVersion = await requireDirectorStageObservation(context, stageId);
  let result: DirectorStageWorkspaceResult;
  if (isDaemonRunning(context.projectId)) {
    result = await sendCommand(context.projectId, {
      action: "update_director_stage_state",
      stageId,
      state: reduced.state,
      actorClientType: resolveCanvasPresenceOptions().clientType,
      observedVersion,
      ifMatch: observedVersion,
    }) as DirectorStageWorkspaceResult;
  } else {
    assertDirectorStageHostWrite("Director Stage update");
    const client = await connectToProject(context.projectId);
    try {
      const updated = client.updateDirectorStageState(stageId, reduced.state);
      result = updated.ok
        ? { stage: updated.stage, version: projectDirectorStageReadToken(updated.stage) }
        : { error: updated.error };
    } finally {
      await client.disconnect();
    }
  }
  if (result.error || !result.stage) {
    throw new Error(result.error ?? "Director Stage update failed");
  }
  await recordDirectorStageObservation(
    context,
    stageId,
    result.readToken ?? result.version ?? projectDirectorStageReadToken(result.stage),
  );
  return result.stage;
}

function addSharedOptions(command: Command): Command {
  return command
    .requiredOption("--stage <id>", "Project-scoped Director Stage ID")
    .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
    .option("--json", "Output result as JSON");
}

function printStageResult(
  stage: ProjectDirectorStage,
  options: { json?: boolean },
): void {
  if (isJsonMode(options)) printJson(stage);
  else console.log(`Updated Director Stage: ${stage.id}`);
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
    const observedVersion = await requireDirectorStageObservation(context, options.stage);
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
    if (result.error || !result.stage) throw new Error(result.error ?? "Director Stage apply failed");
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

const objectCommand = directorCommand.command("object").description("Manage Director Stage objects");

addSharedOptions(objectCommand
  .command("add")
  .description("Add a Director Stage object from the complete first-party catalog")
  .requiredOption("--id <id>", "Object ID")
  .requiredOption("--name <name>", "Object name")
  .addOption(new Option("--kind <kind>", "Object family").choices([
    "mannequin", "primitive", "prop", "set", "vehicle", "light", "crowd", "model",
  ]).makeOptionMandatory())
  .option("--x <number>", "X position", "0")
  .option("--y <number>", "Y position", "0")
  .option("--z <number>", "Z position", "0")
  .option("--color <css-color>", "Object color")
  .option("--body-type <type>", "Mannequin/crowd body type", "neutral")
  .option("--body-shape <number>", "Mannequin body shape from -1 (thin) to 1 (full)", "0")
  .option("--shape <shape>", "Primitive shape", "box")
  .addOption(new Option("--prop-type <type>", "Prop type").choices([
    "chair", "table", "sofa", "crate", "barrel", "floor-lamp",
  ]).default("crate"))
  .addOption(new Option("--set-type <type>", "Set piece type").choices([
    "wall", "doorway", "window", "platform", "cyclorama", "tree", "rock",
  ]).default("wall"))
  .addOption(new Option("--vehicle-type <type>", "Vehicle type").choices([
    "car", "van", "motorcycle", "bicycle", "boat",
  ]).default("car"))
  .addOption(new Option("--light-type <type>", "Light type").choices([
    "point", "spot", "directional",
  ]).default("point"))
  .option("--intensity <number>", "Light intensity", "4")
  .option("--range <number>", "Light range", "20")
  .option("--angle <radians>", "Spot light cone angle in radians", "0.65")
  .option("--rows <number>", "Crowd rows", "3")
  .option("--columns <number>", "Crowd columns", "3")
  .option("--spacing <number>", "Crowd spacing", "1.25")
  .option("--asset <id>", "Uploaded model asset ID"))
  .action(async (options) => {
    const transform = {
      position: [
        finiteNumber(options.x, "--x"),
        finiteNumber(options.y, "--y"),
        finiteNumber(options.z, "--z"),
      ] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    };
    const base = {
      id: options.id,
      name: options.name,
      visible: true,
      ...(options.color ? { color: options.color } : {}),
      transform,
    };
    let object: DirectorStageObject;
    if (options.kind === "mannequin") {
      object = {
        ...base,
        kind: "mannequin",
        mannequin: {
          bodyType: options.bodyType,
          bodyShape: finiteNumber(options.bodyShape, "--body-shape"),
          pose: { preset: "standing", joints: {} },
        },
      } as DirectorStageObject;
    } else if (options.kind === "primitive") {
      object = {
        ...base,
        kind: "primitive",
        primitive: { shape: options.shape },
      } as DirectorStageObject;
    } else if (options.kind === "prop") {
      object = {
        ...base,
        kind: "prop",
        prop: { type: options.propType },
      } as DirectorStageObject;
    } else if (options.kind === "set") {
      object = {
        ...base,
        kind: "set",
        set: { type: options.setType },
      } as DirectorStageObject;
    } else if (options.kind === "vehicle") {
      object = {
        ...base,
        kind: "vehicle",
        vehicle: { type: options.vehicleType },
      } as DirectorStageObject;
    } else if (options.kind === "light") {
      object = {
        ...base,
        kind: "light",
        light: {
          type: options.lightType,
          intensity: finiteNumber(options.intensity, "--intensity"),
          range: finiteNumber(options.range, "--range"),
          angle: finiteNumber(options.angle, "--angle"),
        },
      } as DirectorStageObject;
    } else if (options.kind === "crowd") {
      object = {
        ...base,
        kind: "crowd",
        crowd: {
          rows: positiveInteger(options.rows, "--rows"),
          columns: positiveInteger(options.columns, "--columns"),
          spacing: finiteNumber(options.spacing, "--spacing"),
          bodyType: options.bodyType,
        },
      } as DirectorStageObject;
    } else {
      if (!options.asset) throw new Error("--asset is required for model objects");
      object = {
        ...base,
        kind: "model",
        model: { assetId: options.asset },
      } as DirectorStageObject;
    }
    const context = await resolveCanvasProjectContext(options);
    printStageResult(await updateStageWithCommand(context, options.stage, {
      op: "object.add",
      object,
    }), options);
  });

addSharedOptions(objectCommand
  .command("update")
  .description("Update object properties or transform")
  .requiredOption("--id <id>", "Object ID")
  .option("--name <name>", "Object name")
  .option("--visible <boolean>", "Visibility")
  .option("--color <css-color>", "Object color")
  .option("--body-type <type>", "Mannequin body profile")
  .option("--body-shape <number>", "Mannequin body shape from -1 (thin) to 1 (full)")
  .option("--creature-build <build>", "Horse build: warmblood, draft, or pony")
  .option("--creature-gait <gait>", "Horse gait: auto, idle, walk, trot, or gallop")
  .option("--prop-type <type>", "Prop type")
  .option("--set-type <type>", "Set piece type")
  .option("--vehicle-type <type>", "Vehicle type")
  .option("--light-type <type>", "Light type")
  .option("--intensity <number>", "Light intensity")
  .option("--range <number>", "Light range")
  .option("--angle <radians>", "Spot light cone angle in radians")
  .option("--x <number>", "X position")
  .option("--y <number>", "Y position")
  .option("--z <number>", "Z position")
  .option("--rx <number>", "X rotation in radians")
  .option("--ry <number>", "Y rotation in radians")
  .option("--rz <number>", "Z rotation in radians")
  .option("--sx <number>", "X scale")
  .option("--sy <number>", "Y scale")
  .option("--sz <number>", "Z scale"))
  .action(async (options) => {
    const patch: DirectorStageObjectPatch = {
      ...(options.name !== undefined ? { name: options.name } : {}),
      ...(options.visible !== undefined ? { visible: booleanValue(options.visible, "--visible") } : {}),
      ...(options.color !== undefined ? { color: options.color } : {}),
      ...(options.bodyType !== undefined ? { bodyType: options.bodyType } : {}),
      ...(options.bodyShape !== undefined
        ? { bodyShape: finiteNumber(options.bodyShape, "--body-shape") }
        : {}),
      ...(options.creatureBuild !== undefined ? { creatureBuild: options.creatureBuild } : {}),
      ...(options.creatureGait !== undefined ? { creatureGait: options.creatureGait } : {}),
      ...(options.propType !== undefined ? { propType: options.propType } : {}),
      ...(options.setType !== undefined ? { setType: options.setType } : {}),
      ...(options.vehicleType !== undefined ? { vehicleType: options.vehicleType } : {}),
      ...(options.lightType !== undefined ? { lightType: options.lightType } : {}),
      ...(options.intensity !== undefined ? { lightIntensity: finiteNumber(options.intensity, "--intensity") } : {}),
      ...(options.range !== undefined ? { lightRange: finiteNumber(options.range, "--range") } : {}),
      ...(options.angle !== undefined ? { lightAngle: finiteNumber(options.angle, "--angle") } : {}),
    };
    const position = [
      optionalFiniteNumber(options.x, "--x"),
      optionalFiniteNumber(options.y, "--y"),
      optionalFiniteNumber(options.z, "--z"),
    ];
    const rotation = [
      optionalFiniteNumber(options.rx, "--rx"),
      optionalFiniteNumber(options.ry, "--ry"),
      optionalFiniteNumber(options.rz, "--rz"),
    ];
    const scale = [
      optionalFiniteNumber(options.sx, "--sx"),
      optionalFiniteNumber(options.sy, "--sy"),
      optionalFiniteNumber(options.sz, "--sz"),
    ];
    const context = await resolveCanvasProjectContext(options);
    const stage = await readDirectorStage(context, options.stage);
    const current = stage.state.objects.find((object) => object.id === options.id);
    if (!current) throw new Error(`Object ${options.id} not found`);
    patch.transform = {
      ...(position.some((value) => value !== undefined)
        ? { position: position.map((value, index) => value ?? current.transform.position[index]) as [number, number, number] }
        : {}),
      ...(rotation.some((value) => value !== undefined)
        ? { rotation: rotation.map((value, index) => value ?? current.transform.rotation[index]) as [number, number, number] }
        : {}),
      ...(scale.some((value) => value !== undefined)
        ? { scale: scale.map((value, index) => value ?? current.transform.scale[index]) as [number, number, number] }
        : {}),
    };
    printStageResult(await updateStageWithCommand(context, options.stage, {
      op: "object.update",
      objectId: options.id,
      patch,
    }), options);
  });

addSharedOptions(objectCommand
  .command("remove")
  .description("Remove an object")
  .requiredOption("--id <id>", "Object ID"))
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    printStageResult(await updateStageWithCommand(context, options.stage, {
      op: "object.remove",
      objectId: options.id,
    }), options);
  });

addSharedOptions(objectCommand
  .command("group")
  .description("Group objects")
  .requiredOption("--group <id>", "Group ID")
  .requiredOption("--objects <ids...>", "Object IDs"))
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    printStageResult(await updateStageWithCommand(context, options.stage, {
      op: "object.group",
      objectIds: options.objects,
      groupId: options.group,
    }), options);
  });

addSharedOptions(objectCommand
  .command("ungroup")
  .description("Ungroup objects")
  .requiredOption("--group <id>", "Group ID"))
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    printStageResult(await updateStageWithCommand(context, options.stage, {
      op: "object.ungroup",
      groupId: options.group,
    }), options);
  });

addSharedOptions(objectCommand
  .command("attach")
  .description("Attach an object to another object's semantic socket")
  .requiredOption("--id <id>", "Child object ID")
  .requiredOption("--parent <id>", "Parent object ID")
  .addOption(new Option("--socket <socket>", "Attachment socket").choices([
    "origin", "seat", "saddle",
  ]).makeOptionMandatory()))
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    printStageResult(await updateStageWithCommand(context, options.stage, {
      op: "object.attach",
      objectId: options.id,
      parentId: options.parent,
      socket: options.socket,
    }), options);
  });

addSharedOptions(objectCommand
  .command("detach")
  .description("Detach an object while preserving its local transform")
  .requiredOption("--id <id>", "Child object ID"))
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    printStageResult(await updateStageWithCommand(context, options.stage, {
      op: "object.detach",
      objectId: options.id,
    }), options);
  });

addSharedOptions(objectCommand
  .command("add-horse")
  .description("Add a procedural horse with editable build and gait")
  .requiredOption("--id <id>", "Horse object ID")
  .option("--name <name>", "Horse name", "Horse")
  .addOption(new Option("--build <build>", "Horse build").choices([
    "warmblood", "draft", "pony",
  ]).default("warmblood"))
  .addOption(new Option("--gait <gait>", "Horse gait").choices([
    "auto", "idle", "walk", "trot", "gallop",
  ]).default("auto"))
  .option("--color <css-color>", "Horse coat color", "#7a5137")
  .option("--x <number>", "X position", "0")
  .option("--y <number>", "Y position", "0")
  .option("--z <number>", "Z position", "0"))
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    printStageResult(await updateStageWithCommand(context, options.stage, {
      op: "object.add",
      object: {
        id: options.id,
        name: options.name,
        kind: "creature",
        visible: true,
        color: options.color,
        transform: {
          position: [
            finiteNumber(options.x, "--x"),
            finiteNumber(options.y, "--y"),
            finiteNumber(options.z, "--z"),
          ],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        creature: { species: "horse", build: options.build, gait: options.gait },
      },
    }), options);
  });

addSharedOptions(objectCommand
  .command("add-rider-horse")
  .description("Add a horse and a rider already bound to its saddle")
  .requiredOption("--horse-id <id>", "Horse object ID")
  .requiredOption("--rider-id <id>", "Rider object ID")
  .option("--horse-name <name>", "Horse name", "Horse")
  .option("--rider-name <name>", "Rider name", "Rider")
  .addOption(new Option("--build <build>", "Horse build").choices([
    "warmblood", "draft", "pony",
  ]).default("warmblood"))
  .addOption(new Option("--gait <gait>", "Horse gait").choices([
    "auto", "idle", "walk", "trot", "gallop",
  ]).default("auto"))
  .option("--body-type <type>", "Rider body profile", "neutral")
  .option("--x <number>", "Horse X position", "0")
  .option("--y <number>", "Horse Y position", "0")
  .option("--z <number>", "Horse Z position", "0"))
  .action(async (options) => {
    const horseTransform = {
      position: [
        finiteNumber(options.x, "--x"),
        finiteNumber(options.y, "--y"),
        finiteNumber(options.z, "--z"),
      ] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    };
    const riderTransform = {
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    };
    const objects: DirectorStageObject[] = [
      {
        id: options.horseId,
        name: options.horseName,
        kind: "creature",
        visible: true,
        color: "#7a5137",
        transform: horseTransform,
        creature: { species: "horse", build: options.build, gait: options.gait },
      },
      {
        id: options.riderId,
        name: options.riderName,
        kind: "mannequin",
        visible: true,
        color: "#e8ebef",
        transform: riderTransform,
        attachment: {
          parentId: options.horseId,
          socket: "saddle",
          offset: directorDefaultAttachmentOffset("saddle"),
        },
        mannequin: {
          bodyType: options.bodyType,
          bodyShape: 0,
          pose: { preset: "riding", joints: {} },
        },
      },
    ];
    const context = await resolveCanvasProjectContext(options);
    printStageResult(await updateStageWithCommand(context, options.stage, {
      op: "object.addMany",
      objects,
    }), options);
  });

const cameraCommand = directorCommand.command("camera").description("Manage Director Stage cameras");

addSharedOptions(cameraCommand
  .command("add")
  .description("Add a camera")
  .requiredOption("--id <id>", "Camera ID")
  .requiredOption("--name <name>", "Camera name")
  .option("--x <number>", "X position", "0")
  .option("--y <number>", "Y position", "1.6")
  .option("--z <number>", "Z position", "6")
  .option("--rx <number>", "X rotation", "0")
  .option("--ry <number>", "Y rotation", "0")
  .option("--rz <number>", "Z rotation", "0")
  .option("--fov <number>", "Field of view", "50")
  .option("--target <object-id>", "Follow target object"))
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    printStageResult(await updateStageWithCommand(context, options.stage, {
      op: "camera.add",
      camera: {
        id: options.id,
        name: options.name,
        position: [
          finiteNumber(options.x, "--x"),
          finiteNumber(options.y, "--y"),
          finiteNumber(options.z, "--z"),
        ],
        rotation: [
          finiteNumber(options.rx, "--rx"),
          finiteNumber(options.ry, "--ry"),
          finiteNumber(options.rz, "--rz"),
        ],
        fov: finiteNumber(options.fov, "--fov"),
        ...(options.target ? { targetObjectId: options.target } : {}),
      },
    }), options);
  });

addSharedOptions(cameraCommand
  .command("update")
  .description("Update camera properties")
  .requiredOption("--id <id>", "Camera ID")
  .option("--name <name>", "Camera name")
  .option("--fov <number>", "Field of view")
  .option("--target <object-id>", "Follow target object"))
  .action(async (options) => {
    const patch: DirectorStageCameraPatch = {
      ...(options.name !== undefined ? { name: options.name } : {}),
      ...(options.fov !== undefined ? { fov: finiteNumber(options.fov, "--fov") } : {}),
      ...(options.target !== undefined ? { targetObjectId: options.target } : {}),
    };
    const context = await resolveCanvasProjectContext(options);
    printStageResult(await updateStageWithCommand(context, options.stage, {
      op: "camera.update",
      cameraId: options.id,
      patch,
    }), options);
  });

addSharedOptions(cameraCommand
  .command("remove")
  .description("Remove a camera without captured shots")
  .requiredOption("--id <id>", "Camera ID"))
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    printStageResult(await updateStageWithCommand(context, options.stage, {
      op: "camera.remove",
      cameraId: options.id,
    }), options);
  });

const sceneCommand = directorCommand.command("scene").description("Manage the 3D scene");

addSharedOptions(sceneCommand
  .command("update")
  .description("Update scene background, panorama, or grid")
  .option("--background <css-color>", "Background color")
  .option("--environment <asset-id>", "Panorama asset ID")
  .option("--grid-visible <boolean>", "Grid visibility")
  .option("--grid-snap <boolean>", "Grid snapping")
  .option("--grid-size <number>", "Grid size"))
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    printStageResult(await updateStageWithCommand(context, options.stage, {
      op: "scene.update",
      patch: {
        ...(options.background !== undefined ? { backgroundColor: options.background } : {}),
        ...(options.environment !== undefined ? { environmentAssetId: options.environment } : {}),
        grid: {
          ...(options.gridVisible !== undefined
            ? { visible: booleanValue(options.gridVisible, "--grid-visible") }
            : {}),
          ...(options.gridSnap !== undefined
            ? { snap: booleanValue(options.gridSnap, "--grid-snap") }
            : {}),
          ...(options.gridSize !== undefined
            ? { size: finiteNumber(options.gridSize, "--grid-size") }
            : {}),
        },
      },
    }), options);
  });

const keyframeCommand = directorCommand.command("keyframe").description("Manage 3D property keyframes");

addSharedOptions(keyframeCommand
  .command("upsert")
  .description("Insert or replace a property keyframe")
  .requiredOption("--track <id>", "Track ID")
  .requiredOption("--target <id>", "Object or camera ID")
  .addOption(new Option("--property <name>", "Animated property").choices([
    "position", "rotation", "scale", "fov",
  ]).makeOptionMandatory())
  .requiredOption("--id <id>", "Keyframe ID")
  .requiredOption("--time <seconds>", "Keyframe time")
  .requiredOption("--value <number-or-vector>", "Number or comma-separated x,y,z")
  .option("--interpolation <mode>", "hold, linear, or bezier", "linear")
  .option("--duration <seconds>", "Animation duration", "10")
  .option("--fps <number>", "Animation frames per second", "30"))
  .action(async (options) => {
    const values = String(options.value).split(",").map((value) => finiteNumber(value, "--value"));
    const value = values.length === 1
      ? values[0]
      : values.length === 3
        ? values as [number, number, number]
        : (() => { throw new Error("--value must be one number or x,y,z"); })();
    const context = await resolveCanvasProjectContext(options);
    printStageResult(await updateStageWithCommand(context, options.stage, {
      op: "keyframe.upsert",
      durationSeconds: finiteNumber(options.duration, "--duration"),
      fps: positiveInteger(options.fps, "--fps"),
      track: {
        id: options.track,
        targetId: options.target,
        property: options.property,
      },
      keyframe: {
        id: options.id,
        time: finiteNumber(options.time, "--time"),
        value,
        interpolation: options.interpolation,
      },
    }), options);
  });

addSharedOptions(keyframeCommand
  .command("remove")
  .description("Remove a property keyframe and prune an empty track")
  .requiredOption("--track <id>", "Track ID")
  .requiredOption("--id <id>", "Keyframe ID"))
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    printStageResult(await updateStageWithCommand(context, options.stage, {
      op: "keyframe.remove",
      trackId: options.track,
      keyframeId: options.id,
    }), options);
  });

const actionCommand = directorCommand.command("action").description("Manage timed mannequin action clips");

addSharedOptions(actionCommand
  .command("upsert")
  .description("Insert or replace a mannequin action clip")
  .requiredOption("--id <id>", "Action clip ID")
  .requiredOption("--target <id>", "Mannequin object ID")
  .addOption(new Option("--action <name>", "Action name").choices([
    "idle", "walk", "run", "sit", "crouch", "kneel", "wave", "point", "think", "hands-up", "interact", "ride",
  ]).makeOptionMandatory())
  .addOption(new Option("--layer <name>", "full-body or upper-body").choices([
    "full-body", "upper-body",
  ]))
  .requiredOption("--start <seconds>", "Clip start time")
  .requiredOption("--clip-duration <seconds>", "Clip duration")
  .option("--blend-in <seconds>", "Blend-in duration", "0.2")
  .option("--blend-out <seconds>", "Blend-out duration", "0.2")
  .option("--playback-rate <rate>", "Action playback rate", "1")
  .option("--timeline-duration <seconds>", "Director Stage animation duration", "10")
  .option("--fps <number>", "Animation frames per second", "30"))
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    const upperBodyActions = new Set(["wave", "point", "think", "hands-up"]);
    printStageResult(await updateStageWithCommand(context, options.stage, {
      op: "action.upsert",
      durationSeconds: finiteNumber(options.timelineDuration, "--timeline-duration"),
      fps: positiveInteger(options.fps, "--fps"),
      clip: {
        id: options.id,
        targetId: options.target,
        action: options.action,
        layer: options.layer ?? (upperBodyActions.has(options.action) ? "upper-body" : "full-body"),
        startTime: finiteNumber(options.start, "--start"),
        durationSeconds: finiteNumber(options.clipDuration, "--clip-duration"),
        blendInSeconds: finiteNumber(options.blendIn, "--blend-in"),
        blendOutSeconds: finiteNumber(options.blendOut, "--blend-out"),
        playbackRate: finiteNumber(options.playbackRate, "--playback-rate"),
      },
    }), options);
  });

addSharedOptions(actionCommand
  .command("remove")
  .description("Remove a mannequin action clip")
  .requiredOption("--id <id>", "Action clip ID"))
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    printStageResult(await updateStageWithCommand(context, options.stage, {
      op: "action.remove",
      clipId: options.id,
    }), options);
  });
