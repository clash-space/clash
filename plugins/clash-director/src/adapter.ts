import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
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
      const cwd = directorWorkspaceCwd(input);
      const filePath = join(cwd, "director-stages", `${projectionSegment(stageId)}.director-stage.json`);
      await writeProjection(filePath, `${JSON.stringify(input.state, null, 2)}\n`);
      const args = ["director", "apply", "--stage", stageId, "--file", filePath];
      if (input.projectId?.trim()) args.push("--project", input.projectId.trim());
      args.push("--json");
      return objectResult(await run(args, cwd));
    },
  };
}
