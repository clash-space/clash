import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPythonLocalAsrRuntime,
  type LocalAsrRuntime as LocalAsrRuntimePort,
  type LocalModelStatus,
} from "@clash-space/sdk";

export type LocalAsrProvider = "builtin-funasr";
export type LocalAsrRuntime = "builtin-rpc";
export type LocalAsrSetupStatus = "disabled" | "needs-install" | "ready";

export interface PublicLocalAudioConfig {
  asr: {
    enabled: boolean;
    provider: LocalAsrProvider;
    base_url: string | null;
    model: string;
    has_api_key: boolean;
    ready: boolean;
    setup: {
      provider: "funasr";
      runtime: LocalAsrRuntime;
      status: LocalAsrSetupStatus;
      available: boolean;
      default_base_url: string | null;
      commands: string[];
      message?: string;
    };
  };
}

export interface BuiltinFunAsrTranscribeInput {
  file: File;
  model: string;
  language?: string | null;
}

export interface LocalAudioConfigStore {
  getPublicConfig(): Promise<PublicLocalAudioConfig>;
  updateFromRequest(input: Record<string, unknown>): Promise<PublicLocalAudioConfig>;
  installBuiltin(input?: { model?: unknown }): Promise<PublicLocalAudioConfig>;
  transcribe(input: { file: File; language?: string | null }): Promise<{ text: string }>;
}

export class LocalAudioConfigError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

interface LocalAudioConfigFile {
  version: 1;
  asrEnabled: boolean;
  asrProvider: LocalAsrProvider;
  asrBaseUrl: string | null;
  asrApiKey: string | null;
  asrModel: string;
  updatedAt: string;
}

interface BuiltinFunAsrStatus {
  available: boolean;
  message?: string;
}

interface LocalAudioConfigStoreOptions {
  dataDir: string;
  pythonBinary?: string;
  asrRuntime?: LocalAsrRuntimePort;
  builtinStatus?: () => Promise<BuiltinFunAsrStatus>;
  builtinInstall?: (input: { model: string; pythonBinary: string }) => Promise<void>;
  builtinTranscribe?: (input: BuiltinFunAsrTranscribeInput) => Promise<{ text: string }>;
}

const DEFAULT_ASR_PROVIDER: LocalAsrProvider = "builtin-funasr";
const DEFAULT_ASR_MODEL = "iic/SenseVoiceSmall";
const DEFAULT_PYTHON_BINARY = "python3";

function configPath(dataDir: string): string {
  return join(dataDir, "audio.json");
}

function normalizeProvider(value: unknown): LocalAsrProvider {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_ASR_PROVIDER;
  }
  if (value === "builtin-funasr" || value === "openai-compatible") {
    return DEFAULT_ASR_PROVIDER;
  }
  throw new LocalAudioConfigError("asr_provider must be builtin-funasr");
}

function normalizeModel(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_ASR_MODEL;
}

function normalizeEnabled(value: unknown): boolean {
  return value === true;
}

function defaultConfig(): LocalAudioConfigFile {
  return {
    version: 1,
    asrEnabled: false,
    asrProvider: DEFAULT_ASR_PROVIDER,
    asrBaseUrl: null,
    asrApiKey: null,
    asrModel: DEFAULT_ASR_MODEL,
    updatedAt: new Date(0).toISOString(),
  };
}

function setupStatus(config: LocalAudioConfigFile, builtinStatus: BuiltinFunAsrStatus): LocalAsrSetupStatus {
  if (!config.asrEnabled) return "disabled";
  return builtinStatus.available ? "ready" : "needs-install";
}

async function publicConfig(
  config: LocalAudioConfigFile,
  builtinStatus: BuiltinFunAsrStatus,
): Promise<PublicLocalAudioConfig> {
  const status = setupStatus(config, builtinStatus);
  return {
    asr: {
      enabled: config.asrEnabled,
      provider: DEFAULT_ASR_PROVIDER,
      base_url: null,
      model: config.asrModel,
      has_api_key: false,
      ready: status === "ready",
      setup: {
        provider: "funasr",
        runtime: "builtin-rpc",
        status,
        available: builtinStatus.available,
        default_base_url: null,
        commands: [],
        ...(builtinStatus.message ? { message: builtinStatus.message } : {}),
      },
    },
  };
}

async function readConfigFile(path: string): Promise<LocalAudioConfigFile | null> {
  try {
    const data = JSON.parse(await readFile(path, "utf8")) as Partial<LocalAudioConfigFile>;
    return {
      version: 1,
      asrEnabled: data.asrEnabled === true,
      asrProvider: normalizeProvider(data.asrProvider),
      asrBaseUrl: null,
      asrApiKey: null,
      asrModel: normalizeModel(data.asrModel),
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

async function writeConfigFile(path: string, config: LocalAudioConfigFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2), "utf8");
}

function defaultClashSdkPythonPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..", "packages", "clash-sdk", "python");
}

function displayErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createHookBackedRuntime(
  options: LocalAudioConfigStoreOptions,
  pythonBinary: string,
): LocalAsrRuntimePort | null {
  if (!options.builtinStatus && !options.builtinInstall && !options.builtinTranscribe) return null;
  const fallback = createPythonLocalAsrRuntime({
    pythonBinary,
    pythonPath: defaultClashSdkPythonPath(),
  });
  return {
    async status({ model }) {
      if (options.builtinStatus) return options.builtinStatus();
      if (options.builtinTranscribe) return { available: true };
      return fallback.status({ model });
    },
    async deploy(input) {
      if (options.builtinInstall) {
        await options.builtinInstall({ model: input.model, pythonBinary });
        return;
      }
      await fallback.deploy(input);
    },
    async transcribe(input) {
      if (!options.builtinTranscribe) return fallback.transcribe(input);
      const file = new File(
        [await readFile(input.audioPath)],
        basename(input.audioPath),
        { type: "audio/webm" },
      );
      return options.builtinTranscribe({
        file,
        model: input.model,
        language: input.language,
      });
    },
  };
}

function createDefaultAsrRuntime(options: LocalAudioConfigStoreOptions, pythonBinary: string): LocalAsrRuntimePort {
  return options.asrRuntime
    ?? createHookBackedRuntime(options, pythonBinary)
    ?? createPythonLocalAsrRuntime({
      pythonBinary,
      pythonPath: defaultClashSdkPythonPath(),
    });
}

async function transcribeWithRuntime(
  runtime: LocalAsrRuntimePort,
  input: { file: File; language?: string | null },
  model: string,
): Promise<{ text: string }> {
  const dir = await mkdtemp(join(tmpdir(), "clash-asr-"));
  const extension = extname(input.file.name || "") || ".webm";
  const audioPath = join(dir, basename(input.file.name || `input${extension}`));
  try {
    await writeFile(audioPath, Buffer.from(await input.file.arrayBuffer()));
    return await runtime.transcribe({
      model,
      audioPath,
      language: input.language,
    });
  } catch (error) {
    if (error instanceof LocalAudioConfigError) throw error;
    throw new LocalAudioConfigError(`Local ASR transcription failed: ${displayErrorMessage(error)}`, 502);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function createLocalAudioConfigStore(
  options: LocalAudioConfigStoreOptions,
): LocalAudioConfigStore {
  const path = configPath(options.dataDir);
  const pythonBinary = options.pythonBinary ?? DEFAULT_PYTHON_BINARY;
  const asrRuntime = createDefaultAsrRuntime(options, pythonBinary);

  async function current(): Promise<LocalAudioConfigFile> {
    return (await readConfigFile(path)) ?? defaultConfig();
  }

  async function currentRuntimeStatus(model: string): Promise<LocalModelStatus> {
    try {
      return await asrRuntime.status({ model });
    } catch (error) {
      return { available: false, message: displayErrorMessage(error) };
    }
  }

  return {
    async getPublicConfig() {
      const config = await current();
      return publicConfig(config, await currentRuntimeStatus(config.asrModel));
    },

    async updateFromRequest(input) {
      const existing = await current();
      const enabled = Object.prototype.hasOwnProperty.call(input, "asr_enabled")
        ? normalizeEnabled(input.asr_enabled)
        : existing.asrEnabled;
      const provider = Object.prototype.hasOwnProperty.call(input, "asr_provider")
        ? normalizeProvider(input.asr_provider)
        : DEFAULT_ASR_PROVIDER;
      const model = Object.prototype.hasOwnProperty.call(input, "asr_model")
        ? normalizeModel(input.asr_model)
        : existing.asrModel;

      const next: LocalAudioConfigFile = {
        version: 1,
        asrEnabled: enabled,
        asrProvider: provider,
        asrBaseUrl: null,
        asrApiKey: null,
        asrModel: model,
        updatedAt: new Date().toISOString(),
      };
      await writeConfigFile(path, next);
      return publicConfig(next, await currentRuntimeStatus(next.asrModel));
    },

    async installBuiltin(input = {}) {
      const config = await current();
      const model = Object.prototype.hasOwnProperty.call(input, "model")
        ? normalizeModel(input.model)
        : config.asrModel;
      try {
        await asrRuntime.deploy({ model, kind: "asr" });
      } catch (error) {
        if (error instanceof LocalAudioConfigError) throw error;
        throw new LocalAudioConfigError(`Local ASR deploy failed: ${displayErrorMessage(error)}`, 502);
      }
      const next: LocalAudioConfigFile = {
        ...config,
        asrProvider: DEFAULT_ASR_PROVIDER,
        asrBaseUrl: null,
        asrApiKey: null,
        asrModel: model,
        updatedAt: new Date().toISOString(),
      };
      await writeConfigFile(path, next);
      return publicConfig(next, await currentRuntimeStatus(next.asrModel));
    },

    async transcribe(input) {
      const config = await current();
      if (!config.asrEnabled) {
        throw new LocalAudioConfigError(
          "Local ASR is not enabled. Open Settings > Audio and enable voice input.",
          409,
        );
      }

      const status = await currentRuntimeStatus(config.asrModel);
      if (!status.available) {
        throw new LocalAudioConfigError(
          `Selected ASR model is not deployed. Open Settings > Models and deploy it.${status.message ? ` ${status.message}.` : ""}`,
          409,
        );
      }
      return transcribeWithRuntime(asrRuntime, input, config.asrModel);
    },
  };
}
