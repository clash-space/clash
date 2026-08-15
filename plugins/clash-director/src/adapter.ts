import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  DirectorStageAuthoringStateSchema,
  applyDirectorStageCommand,
  type DirectorStageCommand,
  type DirectorStageState,
  type ProjectHostCommand,
} from "@clash/shared-types";
import {
  createProjectHostClient,
  publicProjectHostValue,
  type ProjectHostClient,
  type ProjectHostResponse,
} from "@clash/shared-runtime/project-host-client";
import type {
  DirectorEntity,
  DirectorPluginToolName,
  DirectorToolInput,
} from "./contract.js";

export type DirectorProjectionWriter = (
  path: string,
  content: string | Uint8Array,
) => Promise<void>;

export type DirectorAdapter = {
  list(input: DirectorToolInput): Promise<DirectorEntity[]>;
  get(input: DirectorToolInput): Promise<DirectorEntity>;
  capture(input: DirectorToolInput): Promise<unknown>;
  create(input: DirectorToolInput): Promise<unknown>;
  save(input: DirectorToolInput): Promise<Record<string, unknown>>;
  attach(input: DirectorToolInput): Promise<unknown>;
  detach(input: DirectorToolInput): Promise<unknown>;
  mutate(name: DirectorPluginToolName, input: DirectorToolInput): Promise<unknown>;
};

export function directorWorkspaceCwd(input: DirectorToolInput): string {
  const candidate = input.cwd?.trim()
    || process.env.CLASH_WORKSPACE_ROOT
    || process.env.CODEX_WORKSPACE_ROOT
    || process.cwd();
  return isAbsolute(candidate) ? candidate : resolve(candidate);
}

function projectionSegment(stageId: string): string {
  return stageId.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^\.+/, "") || "stage";
}

function requiredInputString(input: DirectorToolInput, key: keyof DirectorToolInput): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${String(key)} is required`);
  return value.trim();
}

function requiredInputRecord(
  input: DirectorToolInput,
  key: "object" | "patch" | "camera" | "scene" | "keyframe" | "action",
): Record<string, unknown> {
  const value = input[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  return value;
}

function requiredRecordString(value: Record<string, unknown>, key: string, label: string): string {
  const field = value[key];
  if (typeof field !== "string" || !field.trim()) throw new Error(`${label} is required`);
  return field.trim();
}

function requiredRecordNumber(value: Record<string, unknown>, key: string, label: string): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isFinite(field)) throw new Error(`${label} is required`);
  return field;
}

function directorCommand(name: DirectorPluginToolName, input: DirectorToolInput): DirectorStageCommand {
  switch (name) {
    case "clash_director_object_add":
      return { op: "object.add", object: requiredInputRecord(input, "object") } as DirectorStageCommand;
    case "clash_director_object_update":
      return { op: "object.update", objectId: requiredInputString(input, "objectId"), patch: requiredInputRecord(input, "patch") } as DirectorStageCommand;
    case "clash_director_object_remove":
      return { op: "object.remove", objectId: requiredInputString(input, "objectId") };
    case "clash_director_object_group":
      return { op: "object.group", groupId: requiredInputString(input, "groupId"), objectIds: input.objectIds ?? [] };
    case "clash_director_object_ungroup":
      return { op: "object.ungroup", groupId: requiredInputString(input, "groupId") };
    case "clash_director_camera_add":
      return { op: "camera.add", camera: requiredInputRecord(input, "camera") } as DirectorStageCommand;
    case "clash_director_camera_update":
      return { op: "camera.update", cameraId: requiredInputString(input, "cameraId"), patch: requiredInputRecord(input, "patch") } as DirectorStageCommand;
    case "clash_director_camera_remove":
      return { op: "camera.remove", cameraId: requiredInputString(input, "cameraId") };
    case "clash_director_scene_update":
      return { op: "scene.update", patch: requiredInputRecord(input, "scene") } as DirectorStageCommand;
    case "clash_director_keyframe_upsert": {
      const keyframe = requiredInputRecord(input, "keyframe");
      return {
        op: "keyframe.upsert",
        durationSeconds: requiredRecordNumber(keyframe, "durationSeconds", "keyframe.durationSeconds"),
        fps: requiredRecordNumber(keyframe, "fps", "keyframe.fps"),
        track: {
          id: requiredRecordString(keyframe, "trackId", "keyframe.trackId"),
          targetId: requiredRecordString(keyframe, "targetId", "keyframe.targetId"),
          property: requiredRecordString(keyframe, "property", "keyframe.property"),
        },
        keyframe: {
          id: requiredRecordString(keyframe, "id", "keyframe.id"),
          time: requiredRecordNumber(keyframe, "time", "keyframe.time"),
          value: keyframe.value,
          ...(keyframe.interpolation !== undefined ? { interpolation: keyframe.interpolation } : {}),
        },
      } as DirectorStageCommand;
    }
    case "clash_director_keyframe_remove": {
      const keyframe = requiredInputRecord(input, "keyframe");
      return {
        op: "keyframe.remove",
        trackId: requiredRecordString(keyframe, "trackId", "keyframe.trackId"),
        keyframeId: requiredRecordString(keyframe, "id", "keyframe.id"),
      };
    }
    case "clash_director_action_upsert": {
      const action = requiredInputRecord(input, "action");
      const { timelineDurationSeconds: _duration, fps: _fps, ...clip } = action;
      return {
        op: "action.upsert",
        durationSeconds: requiredRecordNumber(action, "timelineDurationSeconds", "action.timelineDurationSeconds"),
        fps: requiredRecordNumber(action, "fps", "action.fps"),
        clip,
      } as DirectorStageCommand;
    }
    case "clash_director_action_remove":
      return { op: "action.remove", clipId: requiredInputString(input, "actionId") };
    default:
      throw new Error(`Director operation ${name} is not a state mutation`);
  }
}

function hostValue(value: ProjectHostResponse): ProjectHostResponse {
  if (!value.error) return value;
  const code = typeof value.code === "string" ? `${value.code}: ` : "";
  throw new Error(`${code}${value.error}`);
}

async function writeDirectorProjection(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function captureOutputDirectory(input: DirectorToolInput, stageId: string): string {
  const cwd = directorWorkspaceCwd(input);
  const output = input.outputDir?.trim()
    ? resolve(cwd, input.outputDir)
    : join(cwd, "director-stages", projectionSegment(stageId), "captures");
  const path = relative(cwd, output);
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error("Director capture output directory must stay inside the project cwd");
  }
  return output;
}

/** Director MCP adapter backed directly by local-api with host-issued CAS receipts. */
export function createDirectorAdapter(options: {
  client?: ProjectHostClient;
  writeProjection?: DirectorProjectionWriter;
} = {}): DirectorAdapter {
  const client = options.client ?? createProjectHostClient();
  const writeProjection = options.writeProjection ?? writeDirectorProjection;
  const observations = new Map<string, { receipt: string; revisionId?: string }>();
  const boundedMutationTails = new Map<string, Promise<void>>();
  const key = (projectId: string, stageId: string) => `${projectId}\0${stageId}`;
  const context = (input: DirectorToolInput) => client.resolveContext({ cwd: input.cwd, projectId: input.projectId });
  const request = async (input: DirectorToolInput, command: ProjectHostCommand) => {
    const result = await client.request({ cwd: input.cwd, projectId: input.projectId, command });
    return { projectId: result.projectId, value: hostValue(result.value) };
  };
  const requireObservation = async (input: DirectorToolInput, stageId: string) => {
    const resolved = await context(input);
    const observation = observations.get(key(resolved.projectId, stageId));
    if (!observation) {
      throw new Error(`READ_REQUIRED: Read Director Stage ${stageId} with clash_director_get before mutating it.`);
    }
    return observation;
  };
  const serializeBoundedMutation = async <T>(
    input: DirectorToolInput,
    stageId: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const resolved = await context(input);
    const mutationKey = key(resolved.projectId, stageId);
    const preceding = boundedMutationTails.get(mutationKey) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const tail = preceding.catch(() => undefined).then(() => gate);
    boundedMutationTails.set(mutationKey, tail);
    await preceding.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (boundedMutationTails.get(mutationKey) === tail) {
        boundedMutationTails.delete(mutationKey);
      }
    }
  };

  const list = async (input: DirectorToolInput): Promise<DirectorEntity[]> => {
    const result = await request(input, { action: "list_director_stages" });
    const stages = Array.isArray(result.value.stages)
      ? result.value.stages.filter((entry): entry is DirectorEntity => Boolean(
          entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string",
        ))
      : [];
    const versions = result.value.versions && typeof result.value.versions === "object"
      ? result.value.versions as Record<string, unknown>
      : {};
    for (const stage of stages) {
      const receipt = versions[stage.id];
      if (typeof receipt === "string") {
        observations.set(key(result.projectId, stage.id), {
          receipt,
          ...(stage.revisionId ? { revisionId: stage.revisionId } : {}),
        });
      }
    }
    return stages;
  };

  const get = async (input: DirectorToolInput): Promise<DirectorEntity> => {
    const stageId = requiredInputString(input, "stageId");
    const stage = (await list(input)).find((candidate) => candidate.id === stageId);
    if (!stage) throw new Error(`Director Stage ${stageId} not found`);
    return stage;
  };

  const save = async (input: DirectorToolInput): Promise<Record<string, unknown>> => {
    const stageId = requiredInputString(input, "stageId");
    const baseRevisionId = requiredInputString(input, "baseRevisionId");
    const parsed = DirectorStageAuthoringStateSchema.safeParse(input.state);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid Director Stage state");
    const observed = await requireObservation(input, stageId);
    if (observed.revisionId && observed.revisionId !== baseRevisionId) {
      throw new Error(`STALE_READ: Director Stage ${stageId} was read at ${observed.revisionId}, not ${baseRevisionId}`);
    }
    const filePath = join(
      directorWorkspaceCwd(input),
      "director-stages",
      `${projectionSegment(stageId)}.director-stage.json`,
    );
    await writeProjection(filePath, `${JSON.stringify(parsed.data, null, 2)}\n`);
    const result = await request(input, {
      action: "update_director_stage_state",
      stageId,
      state: parsed.data,
      actorClientType: "mcp",
      observedVersion: observed.receipt,
      ifMatch: observed.receipt,
    });
    const receipt = typeof result.value.readToken === "string"
      ? result.value.readToken
      : typeof result.value.version === "string" ? result.value.version : undefined;
    const nextStage = result.value.stage && typeof result.value.stage === "object"
      ? result.value.stage as { revisionId?: unknown }
      : undefined;
    if (receipt) observations.set(key(result.projectId, stageId), {
      receipt,
      ...(typeof nextStage?.revisionId === "string" ? { revisionId: nextStage.revisionId } : {}),
    });
    return publicProjectHostValue(result.value) as Record<string, unknown>;
  };

  return {
    list,
    get,
    async create(input) {
      const stageId = requiredInputString(input, "stageId");
      const result = await request(input, {
        action: "create_director_stage",
        stageId,
        name: requiredInputString(input, "name"),
      });
      const receipt = typeof result.value.readToken === "string"
        ? result.value.readToken
        : typeof result.value.version === "string"
          ? result.value.version
          : undefined;
      if (receipt) observations.set(key(result.projectId, stageId), { receipt });
      return publicProjectHostValue(result.value);
    },
    save,
    async attach(input) {
      const stageId = requiredInputString(input, "stageId");
      const observed = await requireObservation(input, stageId);
      const result = await request(input, {
        action: "attach_director_stage",
        stageId,
        canvasId: requiredInputString(input, "canvasId"),
        ...(input.nodeId?.trim() ? { actionNodeId: input.nodeId.trim() } : {}),
        actorClientType: "mcp",
        observedVersion: observed.receipt,
        ifMatch: observed.receipt,
      });
      const receipt = typeof result.value.readToken === "string"
        ? result.value.readToken
        : typeof result.value.version === "string"
          ? result.value.version
          : undefined;
      if (receipt) observations.set(key(result.projectId, stageId), { receipt });
      return publicProjectHostValue(result.value);
    },
    async detach(input) {
      const stageId = requiredInputString(input, "stageId");
      const observed = await requireObservation(input, stageId);
      const result = await request(input, {
        action: "detach_director_stage",
        stageId,
        actorClientType: "mcp",
        observedVersion: observed.receipt,
        ifMatch: observed.receipt,
      });
      const receipt = typeof result.value.readToken === "string"
        ? result.value.readToken
        : typeof result.value.version === "string"
          ? result.value.version
          : undefined;
      if (receipt) observations.set(key(result.projectId, stageId), { receipt });
      return publicProjectHostValue(result.value);
    },
    async mutate(name, input) {
      const stageId = requiredInputString(input, "stageId");
      return serializeBoundedMutation(input, stageId, async () => {
        const stage = await get(input);
        if (!stage.revisionId) throw new Error(`Director Stage ${stage.id} did not expose a revisionId`);
        const applied = applyDirectorStageCommand(stage.state, directorCommand(name, input));
        if (!applied.ok) throw new Error(applied.error);
        return save({ ...input, baseRevisionId: stage.revisionId, state: applied.state as DirectorStageState });
      });
    },
    async capture(input) {
      const stageId = requiredInputString(input, "stageId");
      if (!Array.isArray(input.times) || input.times.length === 0) throw new Error("times is required");
      const labels = input.labels?.length
        ? input.labels
        : input.times.map((_, index) => `frame-${String(index + 1).padStart(3, "0")}`);
      if (labels.length !== input.times.length) throw new Error("labels count must match times");
      const observed = await requireObservation(input, stageId);
      const frames = input.times.map((timeSeconds, index) => ({
        label: labels[index]!,
        timeSeconds,
        aspectRatio: input.aspectRatio ?? "16:9" as const,
      }));
      const result = await request(input, {
        action: "capture_director_stage",
        stageId,
        frames,
        longEdge: input.longEdge ?? 1920,
        actorClientType: "mcp",
        observedVersion: observed.receipt,
        ifMatch: observed.receipt,
      });
      const outputDir = captureOutputDirectory(input, stageId);
      const capturedFrames = Array.isArray(result.value.frames) ? result.value.frames : [];
      const persistedFrames: Array<Record<string, unknown>> = [];
      for (const raw of capturedFrames) {
        if (!raw || typeof raw !== "object") continue;
        const frame = raw as Record<string, unknown>;
        if (typeof frame.label !== "string" || typeof frame.dataBase64 !== "string") continue;
        const path = join(outputDir, `${projectionSegment(frame.label)}.png`);
        await writeProjection(path, Buffer.from(frame.dataBase64, "base64"));
        const { dataBase64: _data, ...publicFrame } = frame;
        persistedFrames.push({ ...publicFrame, path });
      }
      const receiptPath = join(outputDir, "capture.json");
      const publicResult = publicProjectHostValue(result.value) as Record<string, unknown>;
      const receipt = { ...publicResult, frames: persistedFrames, receiptPath };
      await writeProjection(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
      return receipt;
    },
  };
}
