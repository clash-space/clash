import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ProviderOAuthDriver, ProviderOAuthDeviceFlowStart, ProviderOAuthTokenResult } from "./app";

const execFileAsync = promisify(execFile);

export interface DreaminaCliRunResult {
  stdout: string;
  stderr: string;
}

export type DreaminaCliRun = (
  args: string[],
  options?: { timeoutMs?: number; env?: Record<string, string | undefined> },
) => Promise<DreaminaCliRunResult>;

export interface DreaminaCliAdapterOptions {
  binary?: string;
  run?: DreaminaCliRun;
  env?: Record<string, string | undefined>;
}

export interface DreaminaCliVideoInput extends DreaminaCliAdapterOptions {
  prompt: string;
  modelName?: string;
  upstreamModel?: string;
  duration?: number | string;
  aspectRatio?: string;
}

export interface DreaminaCliSubmitResult {
  taskId: string;
  status?: string;
  model: string;
}

export interface DreaminaCliMediaResult extends DreaminaCliSubmitResult {
  bytes: Uint8Array;
  contentType: string;
}

const DEFAULT_DREAMINA_BIN = "dreamina";

export function createDreaminaCliRun(binary = DEFAULT_DREAMINA_BIN): DreaminaCliRun {
  return async (args, options = {}) => {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      timeout: options.timeoutMs ?? 5 * 60 * 1000,
      env: { ...process.env, ...(options.env ?? {}) },
      windowsHide: true,
    });
    return { stdout, stderr };
  };
}

export function parseDreaminaOAuthOutput(output: string): ProviderOAuthDeviceFlowStart {
  const verificationUri = output.match(/verification_uri:\s*(\S+)/)?.[1];
  const userCode = output.match(/user_code:\s*(\S+)/)?.[1];
  const deviceCode = output.match(/device_code:\s*(\S+)/)?.[1];
  const expiresAt = output.match(/expires_at:\s*(\S+)/)?.[1];
  if (!verificationUri || !userCode || !deviceCode) {
    throw new Error("Dreamina CLI did not print verification_uri, user_code, and device_code.");
  }
  return {
    verificationUri,
    userCode,
    deviceCode,
    ...(expiresAt ? { expiresAt } : {}),
  };
}

function parseSubmitOutput(output: string): { taskId: string; status?: string } {
  const trimmed = output.trim();
  if (trimmed) {
    try {
      const json = JSON.parse(trimmed);
      const taskId = json.submit_id ?? json.task_id ?? json.data?.submit_id ?? json.data?.task_id;
      if (typeof taskId === "string" && taskId) {
        return { taskId, status: json.gen_status ?? json.task_status ?? json.data?.gen_status ?? json.data?.task_status };
      }
    } catch {
      // fall through to regex parser for human-readable CLI output
    }
  }
  const taskId = output.match(/(?:submit_id|task_id|tid|id)["':\s=]+([a-zA-Z0-9_-]+)/i)?.[1];
  if (!taskId) throw new Error(`Dreamina CLI submit output did not contain submit_id. Output: ${output.slice(0, 500)}`);
  const status = output.match(/(?:gen_status|task_status)["':\s=]+([a-zA-Z0-9_-]+)/i)?.[1];
  return { taskId, ...(status ? { status } : {}) };
}

function mediaTypeForFile(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

async function firstDownloadedMedia(downloadDir: string): Promise<{ path: string; contentType: string } | null> {
  const names = await readdir(downloadDir).catch(() => []);
  const media = names
    .filter((name) => /\.(mp4|mov|webm|png|jpe?g)$/i.test(name))
    .sort()[0];
  return media ? { path: join(downloadDir, media), contentType: mediaTypeForFile(media) } : null;
}

export function createDreaminaCliOAuthDriver(options: DreaminaCliAdapterOptions = {}): ProviderOAuthDriver {
  const run = options.run ?? createDreaminaCliRun(options.binary);
  return {
    async start() {
      const result = await run(["login", "--headless"], { timeoutMs: 30_000, env: options.env });
      return parseDreaminaOAuthOutput(`${result.stdout}\n${result.stderr}`);
    },
    async complete(input): Promise<ProviderOAuthTokenResult> {
      await run(["login", "checklogin", `--device_code=${input.deviceCode}`, "--poll=60"], {
        timeoutMs: 70_000,
        env: options.env,
      });
      return {
        accessToken: "cli-managed",
        tokenType: "CLI",
        accountLabel: "Dreamina CLI",
      };
    },
  };
}

function videoCommand(input: DreaminaCliVideoInput): string {
  if (input.modelName === "seedance-2-startend") return "frames2video";
  if (input.modelName === "seedance-2-ref") return "multimodal2video";
  return "text2video";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function generateDreaminaCliVideo(input: DreaminaCliVideoInput): Promise<DreaminaCliSubmitResult> {
  const run = input.run ?? createDreaminaCliRun(input.binary);
  const model = input.upstreamModel ?? "seedance2.0fast";
  const args = [
    videoCommand(input),
    `--prompt=${input.prompt}`,
    `--model_version=${model}`,
    ...(input.duration !== undefined ? [`--duration=${String(input.duration)}`] : []),
    ...(stringValue(input.aspectRatio) ? [`--ratio=${input.aspectRatio}`] : []),
    "--poll=0",
  ];
  const result = await run(args, { timeoutMs: 10 * 60 * 1000, env: input.env });
  const parsed = parseSubmitOutput(`${result.stdout}\n${result.stderr}`);
  return { taskId: parsed.taskId, status: parsed.status, model };
}

export async function generateDreaminaCliVideoMedia(input: DreaminaCliVideoInput & {
  pollIntervalMs?: number;
  maxWaitMs?: number;
}): Promise<DreaminaCliMediaResult> {
  const run = input.run ?? createDreaminaCliRun(input.binary);
  const submitted = await generateDreaminaCliVideo({ ...input, run });
  const downloadDir = await mkdtemp(join(tmpdir(), "dreamina-cli-"));
  try {
    const start = Date.now();
    const pollIntervalMs = input.pollIntervalMs ?? 5000;
    const maxWaitMs = input.maxWaitMs ?? 10 * 60 * 1000;
    while (Date.now() - start <= maxWaitMs) {
      const result = await run([
        "query_result",
        `--submit_id=${submitted.taskId}`,
        `--download_dir=${downloadDir}`,
      ], { timeoutMs: 2 * 60 * 1000, env: input.env });
      const output = `${result.stdout}\n${result.stderr}`;
      if (/gen_status["':\s=]+fail/i.test(output) || /task_status["':\s=]+fail/i.test(output)) {
        throw new Error(`Dreamina CLI task failed: ${output.slice(0, 500)}`);
      }
      const media = await firstDownloadedMedia(downloadDir);
      if (media) {
        return {
          ...submitted,
          bytes: new Uint8Array(await readFile(media.path)),
          contentType: media.contentType,
        };
      }
      if (pollIntervalMs > 0) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(`Dreamina CLI task timed out after ${maxWaitMs}ms. Task: ${submitted.taskId}`);
  } finally {
    await rm(downloadDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
