import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  DirectorStageStateSchema,
  applyDirectorStageCommand,
  type DirectorStageCommand,
  type DirectorStageState,
} from "@clash/shared-types";
import {
  buildDirectorCliArgs,
  type DirectorEntity,
  type DirectorPluginToolName,
  type DirectorToolInput,
} from "./contract.js";

const execFileAsync = promisify(execFile);

export type DirectorCommandRunner = (args: string[], cwd: string) => Promise<unknown>;
export type DirectorProjectionWriter = (path: string, content: string) => Promise<void>;

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
  const candidate =
    input.cwd?.trim() ||
    process.env.CLASH_WORKSPACE_ROOT ||
    process.env.CODEX_WORKSPACE_ROOT ||
    process.cwd();
  return isAbsolute(candidate) ? candidate : resolve(candidate);
}

function projectionSegment(stageId: string): string {
  return stageId.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^\.+/, "") || "stage";
}

function stageList(value: unknown): DirectorEntity[] {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { items?: unknown[] }).items)
      ? (value as { items: unknown[] }).items
      : [];
  return candidates.filter((candidate): candidate is DirectorEntity => Boolean(
    candidate && typeof candidate === "object" &&
    typeof (candidate as { id?: unknown }).id === "string" &&
    (candidate as { state?: unknown }).state &&
    typeof (candidate as { state?: unknown }).state === "object",
  ));
}

function objectResult(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { value };
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

function directorCommand(
  name: DirectorPluginToolName,
  input: DirectorToolInput,
): DirectorStageCommand {
  switch (name) {
    case "clash_director_object_add":
      return { op: "object.add", object: requiredInputRecord(input, "object") } as DirectorStageCommand;
    case "clash_director_object_update":
      return {
        op: "object.update",
        objectId: requiredInputString(input, "objectId"),
        patch: requiredInputRecord(input, "patch"),
      } as DirectorStageCommand;
    case "clash_director_object_remove":
      return { op: "object.remove", objectId: requiredInputString(input, "objectId") };
    case "clash_director_object_group":
      return {
        op: "object.group",
        groupId: requiredInputString(input, "groupId"),
        objectIds: input.objectIds ?? [],
      };
    case "clash_director_object_ungroup":
      return { op: "object.ungroup", groupId: requiredInputString(input, "groupId") };
    case "clash_director_camera_add":
      return { op: "camera.add", camera: requiredInputRecord(input, "camera") } as DirectorStageCommand;
    case "clash_director_camera_update":
      return {
        op: "camera.update",
        cameraId: requiredInputString(input, "cameraId"),
        patch: requiredInputRecord(input, "patch"),
      } as DirectorStageCommand;
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
          ...(keyframe.interpolation !== undefined
            ? { interpolation: keyframe.interpolation }
            : {}),
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

export function createClashDirectorRunner(options: {
  command?: string;
  argsPrefix?: string[];
  env?: NodeJS.ProcessEnv;
} = {}): DirectorCommandRunner {
  const command = options.command ?? process.env.CLASH_CLI_BIN ?? "clash";
  const prefix = options.argsPrefix ?? [];
  return async (args, cwd) => {
    const { stdout } = await execFileAsync(command, [...prefix, ...args], {
      cwd,
      env: options.env ?? process.env,
      maxBuffer: 16 * 1024 * 1024,
    });
    const text = stdout.trim();
    if (!text) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { stdout: text };
    }
  };
}

async function writeDirectorProjection(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

export function createDirectorAdapter(options: {
  run?: DirectorCommandRunner;
  writeProjection?: DirectorProjectionWriter;
} = {}): DirectorAdapter {
  const run = options.run ?? createClashDirectorRunner();
  const writeProjection = options.writeProjection ?? writeDirectorProjection;
  const list = async (input: DirectorToolInput): Promise<DirectorEntity[]> => stageList(
    await run(buildDirectorCliArgs("clash_director_list", input), directorWorkspaceCwd(input)),
  );
  const get = async (input: DirectorToolInput): Promise<DirectorEntity> => {
    const stageId = input.stageId?.trim();
    if (!stageId) throw new Error("stageId is required");
    const stage = (await list(input)).find((candidate) => candidate.id === stageId);
    if (!stage) throw new Error(`Director Stage ${stageId} not found`);
    return stage;
  };
  const invoke = (name: DirectorPluginToolName, input: DirectorToolInput) =>
    run(buildDirectorCliArgs(name, input), directorWorkspaceCwd(input));

  const save = async (input: DirectorToolInput): Promise<Record<string, unknown>> => {
    const stageId = input.stageId?.trim();
    if (!stageId) throw new Error("stageId is required");
    const baseRevisionId = input.baseRevisionId?.trim();
    if (!baseRevisionId) {
      throw new Error("baseRevisionId is required; read the Director Stage before saving");
    }
    const parsedState = DirectorStageStateSchema.safeParse(input.state);
    if (!parsedState.success) {
      throw new Error(
        parsedState.error.issues[0]?.message ?? "state must match the authoritative Director Stage schema",
      );
    }
    const cwd = directorWorkspaceCwd(input);
    const filePath = join(cwd, "director-stages", `${projectionSegment(stageId)}.director-stage.json`);
    await writeProjection(filePath, `${JSON.stringify(parsedState.data, null, 2)}\n`);
    const args = [
      "director", "apply", "--stage", stageId, "--file", filePath,
      "--base-revision", baseRevisionId,
    ];
    if (input.projectId?.trim()) args.push("--project", input.projectId.trim());
    args.push("--json");
    return objectResult(await run(args, cwd));
  };

  const mutate = async (
    name: DirectorPluginToolName,
    input: DirectorToolInput,
  ): Promise<Record<string, unknown>> => {
    const stage = await get(input);
    if (!stage.revisionId) {
      throw new Error(`Director Stage ${stage.id} did not expose a revisionId; read it again before saving`);
    }
    const result = applyDirectorStageCommand(stage.state, directorCommand(name, input));
    if (!result.ok) throw new Error(result.error);
    return save({
      ...input,
      baseRevisionId: stage.revisionId,
      state: result.state as DirectorStageState,
    });
  };

  return {
    list,
    get,
    capture: (input) => invoke("clash_director_capture", input),
    create: (input) => invoke("clash_director_create", input),
    attach: (input) => invoke("clash_director_attach", input),
    detach: (input) => invoke("clash_director_detach", input),
    mutate,
    save,
  };
}
