import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ProviderOAuthDriver, ProviderOAuthDeviceFlowStart, ProviderOAuthTokenResult } from "./app";

const execFileAsync = promisify(execFile);

export interface DreaminaCliRunResult {
  stdout: string;
  stderr: string;
  authState?: string;
}

export class DreaminaCliCommandError extends Error {
  constructor(message: string, public readonly result: DreaminaCliRunResult, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DreaminaCliCommandError";
  }
}

export type DreaminaCliRun = (
  args: string[],
  options?: {
    timeoutMs?: number;
    env?: Record<string, string | undefined>;
    /** `undefined` loads Clash-global DB auth, `null` starts with no auth. */
    authState?: string | null;
    captureAuthState?: boolean;
  },
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
  resolution?: string;
  startFramePath?: string;
  endFramePath?: string;
  referenceImagePaths?: string[];
  referenceVideoPaths?: string[];
  referenceAudioPaths?: string[];
  startFrameUrl?: string;
  endFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  fetch?: typeof fetch;
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
    try {
      const { stdout, stderr } = await execFileAsync(binary, args, {
        timeout: options.timeoutMs ?? 5 * 60 * 1000,
        env: { ...process.env, ...(options.env ?? {}) },
        windowsHide: true,
      });
      return { stdout, stderr };
    } catch (error) {
      const failed = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer };
      throw new DreaminaCliCommandError(failed.message, {
        stdout: String(failed.stdout ?? ""),
        stderr: String(failed.stderr ?? ""),
      }, { cause: error });
    }
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

function extensionForMedia(contentType: string, url: string): string {
  const normalized = contentType.toLowerCase().split(";", 1)[0];
  const byType: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mp4": ".m4a",
  };
  return byType[normalized] ?? url.match(/\.(png|jpe?g|webp|mp4|mov|webm|mp3|wav|m4a)(?:[?#]|$)/i)?.[0]?.toLowerCase() ?? ".bin";
}

async function stageReference(
  url: string,
  targetBase: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const dataUri = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  let bytes: Uint8Array;
  let contentType = "application/octet-stream";
  if (dataUri) {
    contentType = dataUri[1] ?? contentType;
    bytes = new Uint8Array(Buffer.from(dataUri[2] ?? "", "base64"));
  } else {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`Dreamina CLI reference download failed: ${response.status} ${response.statusText}`);
    contentType = response.headers.get("content-type") ?? contentType;
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  const path = `${targetBase}${extensionForMedia(contentType, url)}`;
  await writeFile(path, bytes);
  return path;
}

async function stageReferences(
  urls: readonly string[] | undefined,
  inputDir: string,
  prefix: string,
  fetchImpl: typeof fetch,
): Promise<string[]> {
  return Promise.all((urls ?? []).map((url, index) =>
    stageReference(url, join(inputDir, `${prefix}-${index + 1}`), fetchImpl)));
}

export function createDreaminaCliOAuthDriver(options: DreaminaCliAdapterOptions = {}): ProviderOAuthDriver {
  const run = options.run ?? createDreaminaCliRun(options.binary);
  return {
    async start() {
      const result = await run(["login", "--headless"], {
        timeoutMs: 30_000,
        env: options.env,
        authState: null,
        captureAuthState: true,
      });
      if (!result.authState) {
        throw new Error("Dreamina CLI login did not export OAuth continuation state.");
      }
      return {
        ...parseDreaminaOAuthOutput(`${result.stdout}\n${result.stderr}`),
        oauthState: result.authState,
      };
    },
    async complete(input): Promise<ProviderOAuthTokenResult> {
      let result: DreaminaCliRunResult;
      try {
        result = await run(["login", "checklogin", `--device_code=${input.deviceCode}`, "--poll=60"], {
          timeoutMs: 70_000,
          env: options.env,
          authState: input.oauthState ?? null,
          captureAuthState: true,
        });
      } catch (error) {
        if (error instanceof DreaminaCliCommandError) {
          const output = `${error.result.stdout}\n${error.result.stderr}`.trim();
          if (error.result.authState && /登录成功[\s\S]*没有\s*dreamina_cli\s*使用权限/.test(output)) {
            return {
              accessToken: error.result.authState,
              tokenType: "DREAMINA_KEYRING_V1",
              accountLabel: "Dreamina CLI",
              availabilityError: output,
            };
          }
        }
        throw error;
      }
      if (!result.authState) {
        throw new Error("Dreamina CLI login completed without exporting Clash database auth state.");
      }
      return {
        accessToken: result.authState,
        tokenType: "DREAMINA_KEYRING_V1",
        accountLabel: "Dreamina CLI",
      };
    },
  };
}

function videoCommand(input: DreaminaCliVideoInput): string {
  if (input.modelName === "seedance-2-startend" || input.modelName === "seedance-2.5-startend") {
    return input.endFramePath ? "frames2video" : "image2video";
  }
  if (input.modelName === "seedance-2-ref" || input.modelName === "seedance-2.5-ref") {
    const hasReferences = !!(
      input.referenceImagePaths?.length
      || input.referenceVideoPaths?.length
      || input.referenceAudioPaths?.length
    );
    return hasReferences ? "multimodal2video" : "text2video";
  }
  return "text2video";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function generateDreaminaCliVideo(input: DreaminaCliVideoInput): Promise<DreaminaCliSubmitResult> {
  const run = input.run ?? createDreaminaCliRun(input.binary);
  const model = input.upstreamModel ?? "seedance2.0fast";
  const command = videoCommand(input);
  const args = [
    command,
    `--prompt=${input.prompt}`,
    `--model_version=${model}`,
    ...(input.duration !== undefined ? [`--duration=${String(input.duration)}`] : []),
    ...(stringValue(input.aspectRatio) ? [`--ratio=${input.aspectRatio}`] : []),
    ...(stringValue(input.resolution) ? [`--video_resolution=${input.resolution}`] : []),
    ...(stringValue(input.startFramePath)
      ? [command === "image2video" ? `--image=${input.startFramePath}` : `--first=${input.startFramePath}`]
      : []),
    ...(command === "frames2video" && stringValue(input.endFramePath) ? [`--last=${input.endFramePath}`] : []),
    ...(input.referenceImagePaths ?? []).map((path) => `--image=${path}`),
    ...(input.referenceVideoPaths ?? []).map((path) => `--video=${path}`),
    ...(input.referenceAudioPaths ?? []).map((path) => `--audio=${path}`),
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
  const workDir = await mkdtemp(join(tmpdir(), "dreamina-cli-"));
  try {
    const inputDir = join(workDir, "input");
    const downloadDir = join(workDir, "output");
    await Promise.all([mkdir(inputDir, { recursive: true }), mkdir(downloadDir, { recursive: true })]);
    const fetchImpl = input.fetch ?? fetch;
    const [referenceImagePaths, referenceVideoPaths, referenceAudioPaths] = await Promise.all([
      stageReferences(input.referenceImageUrls, inputDir, "image", fetchImpl),
      stageReferences(input.referenceVideoUrls, inputDir, "video", fetchImpl),
      stageReferences(input.referenceAudioUrls, inputDir, "audio", fetchImpl),
    ]);
    const [startFramePath, endFramePath] = await Promise.all([
      input.startFrameUrl ? stageReference(input.startFrameUrl, join(inputDir, "start"), fetchImpl) : undefined,
      input.endFrameUrl ? stageReference(input.endFrameUrl, join(inputDir, "end"), fetchImpl) : undefined,
    ]);
    const submitted = await generateDreaminaCliVideo({
      ...input,
      run,
      referenceImagePaths,
      referenceVideoPaths,
      referenceAudioPaths,
      ...(startFramePath ? { startFramePath } : {}),
      ...(endFramePath ? { endFramePath } : {}),
    });
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
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
