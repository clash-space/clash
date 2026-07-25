export const DIRECTOR_PLUGIN_TOOL_NAMES = [
  "clash_director_open",
  "clash_director_list",
  "clash_director_get",
  "clash_director_create",
  "clash_director_save",
  "clash_director_attach",
  "clash_director_detach",
  "clash_director_object_add",
  "clash_director_object_update",
  "clash_director_object_remove",
  "clash_director_object_group",
  "clash_director_object_ungroup",
  "clash_director_camera_add",
  "clash_director_camera_update",
  "clash_director_camera_remove",
  "clash_director_scene_update",
  "clash_director_keyframe_upsert",
  "clash_director_keyframe_remove",
  "clash_director_action_upsert",
  "clash_director_action_remove",
] as const;

export type DirectorPluginToolName = (typeof DIRECTOR_PLUGIN_TOOL_NAMES)[number];

export type DirectorEntity = {
  id: string;
  name: string;
  revisionId?: string;
  owner?: { kind?: string; canvasId?: string; actionNodeId?: string };
  state: Record<string, unknown>;
};

export type DirectorToolInput = {
  cwd?: string;
  projectId?: string;
  stageId?: string;
  name?: string;
  canvasId?: string;
  nodeId?: string;
  state?: Record<string, unknown>;
  objectId?: string;
  object?: Record<string, unknown>;
  patch?: Record<string, unknown>;
  objectIds?: string[];
  groupId?: string;
  cameraId?: string;
  camera?: Record<string, unknown>;
  scene?: Record<string, unknown>;
  keyframe?: Record<string, unknown>;
  actionId?: string;
  action?: Record<string, unknown>;
};

function required(input: DirectorToolInput, key: keyof DirectorToolInput): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${String(key)} is required`);
  return value.trim();
}

function flag(args: string[], name: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  args.push(name, String(value));
}

function requiredRecordString(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const field = value[key];
  if (typeof field !== "string" || !field.trim()) throw new Error(`${label} is required`);
  return field.trim();
}

function vectorFlags(args: string[], value: unknown, flags: [string, string, string]): void {
  if (!Array.isArray(value)) return;
  for (let index = 0; index < 3; index += 1) flag(args, flags[index], value[index]);
}

function appendScope(args: string[], input: DirectorToolInput, includeStage = false): void {
  if (includeStage) args.push("--stage", required(input, "stageId"));
  if (input.projectId?.trim()) args.push("--project", input.projectId.trim());
  args.push("--json");
}

function objectAddArgs(input: DirectorToolInput): string[] {
  const object = input.object ?? {};
  const args = ["director", "object", "add"];
  flag(args, "--id", object.id);
  flag(args, "--name", object.name);
  flag(args, "--kind", object.kind);
  flag(args, "--color", object.color);
  const transform = object.transform && typeof object.transform === "object"
    ? object.transform as Record<string, unknown>
    : {};
  vectorFlags(args, transform.position, ["--x", "--y", "--z"]);
  const mannequin = object.mannequin && typeof object.mannequin === "object"
    ? object.mannequin as Record<string, unknown>
    : {};
  const crowd = object.crowd && typeof object.crowd === "object"
    ? object.crowd as Record<string, unknown>
    : {};
  const primitive = object.primitive && typeof object.primitive === "object"
    ? object.primitive as Record<string, unknown>
    : {};
  const model = object.model && typeof object.model === "object"
    ? object.model as Record<string, unknown>
    : {};
  flag(args, "--body-type", mannequin.bodyType ?? crowd.bodyType);
  flag(args, "--shape", primitive.shape);
  flag(args, "--rows", crowd.rows);
  flag(args, "--columns", crowd.columns);
  flag(args, "--spacing", crowd.spacing);
  flag(args, "--asset", model.assetId);
  appendScope(args, input, true);
  return args;
}

function objectUpdateArgs(input: DirectorToolInput): string[] {
  const patch = input.patch ?? {};
  const args = ["director", "object", "update", "--id", required(input, "objectId")];
  flag(args, "--name", patch.name);
  flag(args, "--visible", patch.visible);
  flag(args, "--color", patch.color);
  const transform = patch.transform && typeof patch.transform === "object"
    ? patch.transform as Record<string, unknown>
    : {};
  vectorFlags(args, transform.position, ["--x", "--y", "--z"]);
  vectorFlags(args, transform.rotation, ["--rx", "--ry", "--rz"]);
  vectorFlags(args, transform.scale, ["--sx", "--sy", "--sz"]);
  appendScope(args, input, true);
  return args;
}

function cameraArgs(input: DirectorToolInput, update: boolean): string[] {
  const camera = update ? input.patch ?? {} : input.camera ?? {};
  const id = update ? required(input, "cameraId") : String(camera.id ?? "").trim();
  if (!id) throw new Error("camera.id is required");
  const args = ["director", "camera", update ? "update" : "add", "--id", id];
  flag(args, "--name", camera.name);
  flag(args, "--fov", camera.fov);
  flag(args, "--target", camera.targetObjectId);
  if (!update) {
    vectorFlags(args, camera.position, ["--x", "--y", "--z"]);
    vectorFlags(args, camera.rotation, ["--rx", "--ry", "--rz"]);
  }
  appendScope(args, input, true);
  return args;
}

export function buildDirectorCliArgs(
  name: string,
  input: DirectorToolInput,
): string[] {
  let args: string[];
  switch (name) {
    case "clash_director_list":
      args = ["director", "list"];
      appendScope(args, input);
      return args;
    case "clash_director_create":
      args = ["director", "create", "--id", required(input, "stageId"), "--name", required(input, "name")];
      appendScope(args, input);
      return args;
    case "clash_director_attach":
      args = ["director", "attach", "--stage", required(input, "stageId"), "--canvas", required(input, "canvasId")];
      flag(args, "--node", input.nodeId);
      appendScope(args, input);
      return args;
    case "clash_director_detach":
      args = ["director", "detach", "--stage", required(input, "stageId")];
      appendScope(args, input);
      return args;
    case "clash_director_object_add":
      return objectAddArgs(input);
    case "clash_director_object_update":
      return objectUpdateArgs(input);
    case "clash_director_object_remove":
      args = ["director", "object", "remove", "--id", required(input, "objectId")];
      appendScope(args, input, true);
      return args;
    case "clash_director_object_group":
      args = ["director", "object", "group", "--group", required(input, "groupId"), "--objects", ...(input.objectIds ?? [])];
      appendScope(args, input, true);
      return args;
    case "clash_director_object_ungroup":
      args = ["director", "object", "ungroup", "--group", required(input, "groupId")];
      appendScope(args, input, true);
      return args;
    case "clash_director_camera_add":
      return cameraArgs(input, false);
    case "clash_director_camera_update":
      return cameraArgs(input, true);
    case "clash_director_camera_remove":
      args = ["director", "camera", "remove", "--id", required(input, "cameraId")];
      appendScope(args, input, true);
      return args;
    case "clash_director_scene_update": {
      const scene = input.scene ?? {};
      const grid = scene.grid && typeof scene.grid === "object" ? scene.grid as Record<string, unknown> : {};
      args = ["director", "scene", "update"];
      flag(args, "--background", scene.backgroundColor);
      flag(args, "--environment", scene.environmentAssetId);
      flag(args, "--grid-visible", grid.visible);
      flag(args, "--grid-snap", grid.snap);
      flag(args, "--grid-size", grid.size);
      appendScope(args, input, true);
      return args;
    }
    case "clash_director_keyframe_upsert": {
      const value = input.keyframe ?? {};
      args = ["director", "keyframe", "upsert"];
      for (const [flagName, field] of [
        ["--track", "trackId"], ["--target", "targetId"], ["--property", "property"],
        ["--id", "id"], ["--time", "time"], ["--interpolation", "interpolation"],
        ["--duration", "durationSeconds"], ["--fps", "fps"],
      ] as const) flag(args, flagName, value[field]);
      flag(args, "--value", Array.isArray(value.value) ? value.value.join(",") : value.value);
      appendScope(args, input, true);
      return args;
    }
    case "clash_director_keyframe_remove": {
      const value = input.keyframe ?? {};
      args = [
        "director", "keyframe", "remove",
        "--track", requiredRecordString(value, "trackId", "keyframe.trackId"),
        "--id", requiredRecordString(value, "id", "keyframe.id"),
      ];
      appendScope(args, input, true);
      return args;
    }
    case "clash_director_action_upsert": {
      const value = input.action ?? {};
      args = ["director", "action", "upsert"];
      for (const [flagName, field] of [
        ["--id", "id"], ["--target", "targetId"], ["--action", "action"],
        ["--layer", "layer"], ["--start", "startTime"],
        ["--clip-duration", "durationSeconds"], ["--blend-in", "blendInSeconds"],
        ["--blend-out", "blendOutSeconds"], ["--playback-rate", "playbackRate"],
        ["--timeline-duration", "timelineDurationSeconds"], ["--fps", "fps"],
      ] as const) flag(args, flagName, value[field]);
      appendScope(args, input, true);
      return args;
    }
    case "clash_director_action_remove":
      args = ["director", "action", "remove", "--id", required(input, "actionId")];
      appendScope(args, input, true);
      return args;
    default:
      throw new Error(`Director operation ${name} is not exposed`);
  }
}
