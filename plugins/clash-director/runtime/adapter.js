#!/usr/bin/env node

// src/adapter.ts
import { execFile } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { dirname, isAbsolute, join, resolve } from "path";
import { promisify } from "util";

// src/contract.ts
function required(input, key) {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${String(key)} is required`);
  return value.trim();
}
function flag(args, name, value) {
  if (value === void 0 || value === null || value === "") return;
  args.push(name, String(value));
}
function requiredRecordString(value, key, label) {
  const field = value[key];
  if (typeof field !== "string" || !field.trim()) throw new Error(`${label} is required`);
  return field.trim();
}
function vectorFlags(args, value, flags) {
  if (!Array.isArray(value)) return;
  for (let index = 0; index < 3; index += 1) flag(args, flags[index], value[index]);
}
function appendScope(args, input, includeStage = false) {
  if (includeStage) args.push("--stage", required(input, "stageId"));
  if (input.projectId?.trim()) args.push("--project", input.projectId.trim());
  args.push("--json");
}
function objectAddArgs(input) {
  const object = input.object ?? {};
  const args = ["director", "object", "add"];
  flag(args, "--id", object.id);
  flag(args, "--name", object.name);
  flag(args, "--kind", object.kind);
  flag(args, "--color", object.color);
  const transform = object.transform && typeof object.transform === "object" ? object.transform : {};
  vectorFlags(args, transform.position, ["--x", "--y", "--z"]);
  const mannequin = object.mannequin && typeof object.mannequin === "object" ? object.mannequin : {};
  const crowd = object.crowd && typeof object.crowd === "object" ? object.crowd : {};
  const primitive = object.primitive && typeof object.primitive === "object" ? object.primitive : {};
  const model = object.model && typeof object.model === "object" ? object.model : {};
  flag(args, "--body-type", mannequin.bodyType ?? crowd.bodyType);
  flag(args, "--shape", primitive.shape);
  flag(args, "--rows", crowd.rows);
  flag(args, "--columns", crowd.columns);
  flag(args, "--spacing", crowd.spacing);
  flag(args, "--asset", model.assetId);
  appendScope(args, input, true);
  return args;
}
function objectUpdateArgs(input) {
  const patch = input.patch ?? {};
  const args = ["director", "object", "update", "--id", required(input, "objectId")];
  flag(args, "--name", patch.name);
  flag(args, "--visible", patch.visible);
  flag(args, "--color", patch.color);
  const transform = patch.transform && typeof patch.transform === "object" ? patch.transform : {};
  vectorFlags(args, transform.position, ["--x", "--y", "--z"]);
  vectorFlags(args, transform.rotation, ["--rx", "--ry", "--rz"]);
  vectorFlags(args, transform.scale, ["--sx", "--sy", "--sz"]);
  appendScope(args, input, true);
  return args;
}
function cameraArgs(input, update) {
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
function buildDirectorCliArgs(name, input) {
  let args;
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
      args = ["director", "object", "group", "--group", required(input, "groupId"), "--objects", ...input.objectIds ?? []];
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
      const grid = scene.grid && typeof scene.grid === "object" ? scene.grid : {};
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
        ["--track", "trackId"],
        ["--target", "targetId"],
        ["--property", "property"],
        ["--id", "id"],
        ["--time", "time"],
        ["--interpolation", "interpolation"],
        ["--duration", "durationSeconds"],
        ["--fps", "fps"]
      ]) flag(args, flagName, value[field]);
      flag(args, "--value", Array.isArray(value.value) ? value.value.join(",") : value.value);
      appendScope(args, input, true);
      return args;
    }
    case "clash_director_keyframe_remove": {
      const value = input.keyframe ?? {};
      args = [
        "director",
        "keyframe",
        "remove",
        "--track",
        requiredRecordString(value, "trackId", "keyframe.trackId"),
        "--id",
        requiredRecordString(value, "id", "keyframe.id")
      ];
      appendScope(args, input, true);
      return args;
    }
    case "clash_director_action_upsert": {
      const value = input.action ?? {};
      args = ["director", "action", "upsert"];
      for (const [flagName, field] of [
        ["--id", "id"],
        ["--target", "targetId"],
        ["--action", "action"],
        ["--layer", "layer"],
        ["--start", "startTime"],
        ["--clip-duration", "durationSeconds"],
        ["--blend-in", "blendInSeconds"],
        ["--blend-out", "blendOutSeconds"],
        ["--playback-rate", "playbackRate"],
        ["--timeline-duration", "timelineDurationSeconds"],
        ["--fps", "fps"]
      ]) flag(args, flagName, value[field]);
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

// src/adapter.ts
var execFileAsync = promisify(execFile);
function workspaceCwd(input) {
  const candidate = input.cwd?.trim() || process.env.CODEX_WORKSPACE_ROOT || process.cwd();
  return isAbsolute(candidate) ? candidate : resolve(candidate);
}
function projectionSegment(stageId) {
  return stageId.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^\.+/, "") || "stage";
}
function stageList(value) {
  const candidates = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray(value.items) ? value.items : [];
  return candidates.filter((candidate) => Boolean(
    candidate && typeof candidate === "object" && typeof candidate.id === "string" && candidate.state && typeof candidate.state === "object"
  ));
}
function objectResult(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : { value };
}
function createClashDirectorRunner(options = {}) {
  const command = options.command ?? process.env.CLASH_CLI_BIN ?? "clash";
  const prefix = options.argsPrefix ?? [];
  return async (args, cwd) => {
    const { stdout } = await execFileAsync(command, [...prefix, ...args], {
      cwd,
      env: options.env ?? process.env,
      maxBuffer: 16 * 1024 * 1024
    });
    const text = stdout.trim();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { stdout: text };
    }
  };
}
async function writeDirectorProjection(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}
function createDirectorAdapter(options = {}) {
  const run = options.run ?? createClashDirectorRunner();
  const writeProjection = options.writeProjection ?? writeDirectorProjection;
  const list = async (input) => stageList(
    await run(buildDirectorCliArgs("clash_director_list", input), workspaceCwd(input))
  );
  const get = async (input) => {
    const stageId = input.stageId?.trim();
    if (!stageId) throw new Error("stageId is required");
    const stage = (await list(input)).find((candidate) => candidate.id === stageId);
    if (!stage) throw new Error(`Director Stage ${stageId} not found`);
    return stage;
  };
  const invoke = (name, input) => run(buildDirectorCliArgs(name, input), workspaceCwd(input));
  return {
    list,
    get,
    create: (input) => invoke("clash_director_create", input),
    attach: (input) => invoke("clash_director_attach", input),
    detach: (input) => invoke("clash_director_detach", input),
    mutate: invoke,
    async save(input) {
      const stageId = input.stageId?.trim();
      if (!stageId) throw new Error("stageId is required");
      if (!input.state || typeof input.state !== "object" || Array.isArray(input.state)) {
        throw new Error("state must be a Director Stage object");
      }
      await get(input);
      const cwd = workspaceCwd(input);
      const filePath = join(cwd, "director-stages", `${projectionSegment(stageId)}.director-stage.json`);
      await writeProjection(filePath, `${JSON.stringify(input.state, null, 2)}
`);
      const args = ["director", "apply", "--stage", stageId, "--file", filePath];
      if (input.projectId?.trim()) args.push("--project", input.projectId.trim());
      args.push("--json");
      return objectResult(await run(args, cwd));
    }
  };
}
export {
  createClashDirectorRunner,
  createDirectorAdapter
};
