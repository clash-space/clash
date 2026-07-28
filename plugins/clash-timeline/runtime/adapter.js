#!/usr/bin/env node

// src/adapter.ts
import { execFile } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { dirname, isAbsolute, join, resolve } from "path";
import { promisify } from "util";

// src/contract.ts
function required(input, key) {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${String(key)} is required`);
  }
  return value.trim();
}
function appendProject(args, input) {
  if (input.projectId?.trim()) args.push("--project", input.projectId.trim());
  args.push("--json");
}
function buildTimelineCliArgs(name, input) {
  const args = ["timeline"];
  switch (name) {
    case "clash_timeline_list":
      args.push("list");
      break;
    case "clash_timeline_create":
      args.push(
        "create",
        "--id",
        required(input, "timelineId"),
        "--name",
        required(input, "name")
      );
      break;
    case "clash_timeline_attach":
      args.push(
        "attach",
        "--timeline",
        required(input, "timelineId"),
        "--canvas",
        required(input, "canvasId")
      );
      if (input.nodeId?.trim()) args.push("--node", input.nodeId.trim());
      break;
    case "clash_timeline_detach":
      args.push("detach", "--timeline", required(input, "timelineId"));
      break;
    case "clash_timeline_copy":
      args.push(
        "copy",
        "--timeline",
        required(input, "timelineId"),
        "--canvas",
        required(input, "canvasId")
      );
      if (input.newTimelineId?.trim()) {
        args.push("--new-timeline", input.newTimelineId.trim());
      }
      if (input.newNodeId?.trim()) args.push("--new-node", input.newNodeId.trim());
      break;
    default:
      throw new Error(`Timeline operation ${name} is not exposed`);
  }
  appendProject(args, input);
  return args;
}

// src/adapter.ts
var execFileAsync = promisify(execFile);
function timelineWorkspaceCwd(input) {
  const candidate = input.cwd?.trim() || process.env.CLASH_WORKSPACE_ROOT || process.env.CODEX_WORKSPACE_ROOT || process.cwd();
  return isAbsolute(candidate) ? candidate : resolve(candidate);
}
function projectionSegment(timelineId) {
  return timelineId.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^\.+/, "") || "timeline";
}
function timelineList(value) {
  const candidates = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray(value.items) ? value.items : [];
  return candidates.filter((candidate) => Boolean(
    candidate && typeof candidate === "object" && typeof candidate.id === "string"
  ));
}
function objectResult(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : { value };
}
function createClashTimelineRunner(options = {}) {
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
async function writeTimelineProjection(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}
function createTimelineAdapter(options = {}) {
  const run = options.run ?? createClashTimelineRunner();
  const writeProjection = options.writeProjection ?? writeTimelineProjection;
  const list = async (input) => {
    const value = await run(
      buildTimelineCliArgs("clash_timeline_list", input),
      timelineWorkspaceCwd(input)
    );
    return timelineList(value);
  };
  const get = async (input) => {
    const timelineId = input.timelineId?.trim();
    if (!timelineId) throw new Error("timelineId is required");
    const timeline = (await list(input)).find((candidate) => candidate.id === timelineId);
    if (!timeline) throw new Error(`Timeline ${timelineId} not found`);
    return timeline;
  };
  const invoke = async (name, input) => run(buildTimelineCliArgs(name, input), timelineWorkspaceCwd(input));
  return {
    list,
    get,
    create: (input) => invoke("clash_timeline_create", input),
    attach: (input) => invoke("clash_timeline_attach", input),
    detach: (input) => invoke("clash_timeline_detach", input),
    copy: (input) => invoke("clash_timeline_copy", input),
    async save(input) {
      const timelineId = input.timelineId?.trim();
      if (!timelineId) throw new Error("timelineId is required");
      if (!input.state || typeof input.state !== "object" || Array.isArray(input.state)) {
        throw new Error("state must be a Timeline object");
      }
      await get(input);
      const cwd = timelineWorkspaceCwd(input);
      const filePath = join(
        cwd,
        "timelines",
        `${projectionSegment(timelineId)}.timeline.yaml`
      );
      await writeProjection(filePath, `${JSON.stringify(input.state, null, 2)}
`);
      const args = [
        "timeline",
        "apply",
        "--timeline",
        timelineId,
        "--file",
        filePath
      ];
      if (input.projectId?.trim()) args.push("--project", input.projectId.trim());
      args.push("--json");
      return objectResult(await run(args, cwd));
    }
  };
}
export {
  createClashTimelineRunner,
  createTimelineAdapter,
  timelineWorkspaceCwd
};
