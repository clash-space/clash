import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  buildTimelineCliArgs,
  type TimelineEntity,
  type TimelineToolInput,
} from "./contract.js";

const execFileAsync = promisify(execFile);

export type TimelineCommandRunner = (
  args: string[],
  cwd: string,
) => Promise<unknown>;

export type TimelineProjectionWriter = (
  path: string,
  content: string,
) => Promise<void>;

export type TimelineAdapter = {
  list(input: TimelineToolInput): Promise<TimelineEntity[]>;
  get(input: TimelineToolInput): Promise<TimelineEntity>;
  create(input: TimelineToolInput): Promise<unknown>;
  save(input: TimelineToolInput): Promise<Record<string, unknown>>;
  attach(input: TimelineToolInput): Promise<unknown>;
  detach(input: TimelineToolInput): Promise<unknown>;
  copy(input: TimelineToolInput): Promise<unknown>;
};

function workspaceCwd(input: TimelineToolInput): string {
  const candidate = input.cwd?.trim() || process.env.CODEX_WORKSPACE_ROOT || process.cwd();
  return isAbsolute(candidate) ? candidate : resolve(candidate);
}

function projectionSegment(timelineId: string): string {
  return timelineId
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^\.+/, "") || "timeline";
}

function timelineList(value: unknown): TimelineEntity[] {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { items?: unknown[] }).items)
      ? (value as { items: unknown[] }).items
      : [];
  return candidates.filter((candidate): candidate is TimelineEntity => Boolean(
    candidate &&
    typeof candidate === "object" &&
    typeof (candidate as { id?: unknown }).id === "string",
  ));
}

function objectResult(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { value };
}

export function createClashTimelineRunner(options: {
  command?: string;
  argsPrefix?: string[];
  env?: NodeJS.ProcessEnv;
} = {}): TimelineCommandRunner {
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

async function writeTimelineProjection(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

export function createTimelineAdapter(options: {
  run?: TimelineCommandRunner;
  writeProjection?: TimelineProjectionWriter;
} = {}): TimelineAdapter {
  const run = options.run ?? createClashTimelineRunner();
  const writeProjection = options.writeProjection ?? writeTimelineProjection;

  const list = async (input: TimelineToolInput): Promise<TimelineEntity[]> => {
    const value = await run(
      buildTimelineCliArgs("clash_timeline_list", input),
      workspaceCwd(input),
    );
    return timelineList(value);
  };

  const get = async (input: TimelineToolInput): Promise<TimelineEntity> => {
    const timelineId = input.timelineId?.trim();
    if (!timelineId) throw new Error("timelineId is required");
    const timeline = (await list(input)).find((candidate) => candidate.id === timelineId);
    if (!timeline) throw new Error(`Timeline ${timelineId} not found`);
    return timeline;
  };

  const invoke = async (name: string, input: TimelineToolInput): Promise<unknown> => (
    run(buildTimelineCliArgs(name, input), workspaceCwd(input))
  );

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
      const cwd = workspaceCwd(input);
      const filePath = join(
        cwd,
        "timelines",
        `${projectionSegment(timelineId)}.timeline.yaml`,
      );
      await writeProjection(filePath, `${JSON.stringify(input.state, null, 2)}\n`);
      const args = [
        "timeline",
        "apply",
        "--timeline",
        timelineId,
        "--file",
        filePath,
      ];
      if (input.projectId?.trim()) args.push("--project", input.projectId.trim());
      args.push("--json");
      return objectResult(await run(args, cwd));
    },
  };
}
