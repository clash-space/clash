import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  buildTimelineCliArgs,
  type TimelineEntity,
  type TimelineToolInput,
} from "./contract.js";
import { assertTimelineState } from "./timeline-contract-adapter.js";

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
  schema(input: TimelineToolInput): Promise<Record<string, unknown>>;
  validate(input: TimelineToolInput): Promise<Record<string, unknown>>;
  list(input: TimelineToolInput): Promise<TimelineEntity[]>;
  get(input: TimelineToolInput): Promise<TimelineEntity>;
  create(input: TimelineToolInput): Promise<unknown>;
  save(input: TimelineToolInput): Promise<Record<string, unknown>>;
  attach(input: TimelineToolInput): Promise<unknown>;
  detach(input: TimelineToolInput): Promise<unknown>;
  copy(input: TimelineToolInput): Promise<unknown>;
  render(input: TimelineToolInput): Promise<Record<string, unknown>>;
};

export function timelineWorkspaceCwd(input: TimelineToolInput): string {
  const candidate =
    input.cwd?.trim() ||
    process.env.CLASH_WORKSPACE_ROOT ||
    process.env.CODEX_WORKSPACE_ROOT ||
    process.cwd();
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
  const configuredCommand = (
    options.command
    ?? options.env?.CLASH_CLI_BIN
    ?? process.env.CLASH_CLI_BIN
  )?.trim();
  const command = configuredCommand || process.execPath;
  const prefix = options.argsPrefix ?? (
    configuredCommand
      ? []
      : [fileURLToPath(new URL("../runtime/clash-cli.cjs", import.meta.url))]
  );
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
      timelineWorkspaceCwd(input),
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
    run(buildTimelineCliArgs(name, input), timelineWorkspaceCwd(input))
  );

  return {
    schema: async (input) => objectResult(await run(
      buildTimelineCliArgs("clash_timeline_schema", input),
      timelineWorkspaceCwd(input),
    )),
    async validate(input) {
      const document = input.document ?? input.state;
      if (typeof document !== "string"
        && (!document || typeof document !== "object" || Array.isArray(document))) {
        throw new Error("document must be Timeline YAML, JSON, or an object");
      }
      if (typeof document !== "string") assertTimelineState(document);
      const cwd = timelineWorkspaceCwd(input);
      const validationDirectory = await mkdtemp(join(tmpdir(), "clash-timeline-validate-"));
      const filePath = join(
        validationDirectory,
        typeof document !== "string" || input.format === "json" || input.format === "object"
          ? "timeline.json"
          : "timeline.yaml",
      );
      try {
        const content = typeof document === "string"
          ? document
          : JSON.stringify(document, null, 2);
        await writeProjection(filePath, `${content}\n`);
        return objectResult(await run(
          ["timeline", "validate", "--file", filePath, "--json"],
          cwd,
        ));
      } finally {
        await rm(validationDirectory, { recursive: true, force: true });
      }
    },
    list,
    get,
    create: (input) => invoke("clash_timeline_create", input),
    attach: (input) => invoke("clash_timeline_attach", input),
    detach: (input) => invoke("clash_timeline_detach", input),
    copy: (input) => invoke("clash_timeline_copy", input),
    render: async (input) => objectResult(await invoke("clash_timeline_render", input)),
    async save(input) {
      const timelineId = input.timelineId?.trim();
      if (!timelineId) throw new Error("timelineId is required");
      if (!input.state || typeof input.state !== "object" || Array.isArray(input.state)) {
        throw new Error("state must be a Timeline object");
      }
      assertTimelineState(input.state);

      const baseRevisionId = input.baseRevisionId?.trim();
      if (!baseRevisionId) {
        throw new Error("baseRevisionId is required; read the Timeline before saving");
      }
      const cwd = timelineWorkspaceCwd(input);
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
        "--base-revision",
        baseRevisionId,
      ];
      if (input.projectId?.trim()) args.push("--project", input.projectId.trim());
      args.push("--json");
      return objectResult(await run(args, cwd));
    },
  };
}
