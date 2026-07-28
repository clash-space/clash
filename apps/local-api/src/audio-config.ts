import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPythonLocalAsrRuntime,
  createPythonLocalTtsRuntime,
  type LocalAsrTranscription,
  type LocalAsrRuntime as LocalAsrRuntimePort,
  type LocalModelStatus,
  type LocalSpeechCapability,
  type LocalTtsRuntime as LocalTtsRuntimePort,
  type LocalTtsSynthesis,
} from "@clash-space/sdk";
import { createSqliteLocalConfigStore, type SqliteLocalConfigStore } from "./local-config-store.js";
import {
  createClashUserConfigStore,
  type ClashUserConfigStore,
} from "./user-config.js";

export type LocalAsrProvider = "builtin-funasr";
export type LocalTtsProvider = "builtin-piper";
export type LocalAsrRuntime = "builtin-rpc";
export type LocalSpeechSetupStatus = "disabled" | "needs-install" | "ready";

export interface PublicLocalAudioConfig {
  asr: {
    capability: "speech-to-text";
    enabled: boolean;
    provider: LocalAsrProvider;
    base_url: string | null;
    model: string;
    has_api_key: boolean;
    ready: boolean;
    setup: {
      provider: "funasr";
      runtime: LocalAsrRuntime;
      status: LocalSpeechSetupStatus;
      available: boolean;
      default_base_url: string | null;
      commands: string[];
      message?: string;
    };
  };
  tts: {
    capability: "text-to-speech";
    enabled: boolean;
    provider: LocalTtsProvider;
    base_url: null;
    model: string;
    has_api_key: false;
    ready: boolean;
    setup: {
      provider: "piper";
      runtime: LocalAsrRuntime;
      status: LocalSpeechSetupStatus;
      available: boolean;
      default_base_url: null;
      commands: string[];
      message?: string;
    };
  };
}

export type LocalAudioConfigReadState = PublicLocalAudioConfig & {
  updated_at: string;
};

export interface PublicLocalSpeechModelStatus {
  capability: LocalSpeechCapability;
  model: string;
  available: boolean;
  message?: string;
}

export interface BuiltinFunAsrTranscribeInput {
  file: File;
  model: string;
  language?: string | null;
}

export interface LocalAudioConfigStore {
  getPublicConfig(): Promise<PublicLocalAudioConfig>;
  getReadState?(): Promise<LocalAudioConfigReadState>;
  getModelStatus(input: { capability?: unknown; model?: unknown }): Promise<PublicLocalSpeechModelStatus>;
  updateFromRequest(input: Record<string, unknown>): Promise<PublicLocalAudioConfig>;
  installBuiltin(input?: { capability?: unknown; model?: unknown }): Promise<PublicLocalAudioConfig>;
  removeBuiltin(input: { capability?: unknown; model?: unknown }): Promise<PublicLocalAudioConfig>;
  transcribe(input: { file: File; language?: string | null }): Promise<LocalAsrTranscription>;
  synthesize(input: {
    model: string;
    text: string;
    voice?: string | null;
    speed?: number;
  }): Promise<{
    audio: Uint8Array;
    metadata: Omit<LocalTtsSynthesis, "outputPath">;
  }>;
}

export class LocalAudioConfigError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

interface LocalAudioConfigFile {
  version: 2;
  asrEnabled: boolean;
  asrProvider: LocalAsrProvider;
  asrBaseUrl: string | null;
  asrApiKey: string | null;
  asrModel: string;
  ttsEnabled: boolean;
  ttsProvider: LocalTtsProvider;
  ttsModel: string;
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
  ttsRuntime?: LocalTtsRuntimePort;
  builtinStatus?: () => Promise<BuiltinFunAsrStatus>;
  builtinInstall?: (input: { model: string; pythonBinary: string }) => Promise<void>;
  builtinTranscribe?: (input: BuiltinFunAsrTranscribeInput) => Promise<LocalAsrTranscription>;
}

const DEFAULT_ASR_PROVIDER: LocalAsrProvider = "builtin-funasr";
const DEFAULT_ASR_MODEL = "iic/SenseVoiceSmall";
const DEFAULT_TTS_PROVIDER: LocalTtsProvider = "builtin-piper";
const DEFAULT_TTS_MODEL = "zh_CN-huayan-medium";
const DEFAULT_PYTHON_BINARY = "python3";
const LOCAL_AUDIO_CONFIG_KEY = "local-audio-config";

function normalizeProvider(value: unknown): LocalAsrProvider {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_ASR_PROVIDER;
  }
  if (value === "builtin-funasr" || value === "openai-compatible") {
    return DEFAULT_ASR_PROVIDER;
  }
  throw new LocalAudioConfigError("asr_provider must be builtin-funasr");
}

function normalizeModel(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeTtsProvider(value: unknown): LocalTtsProvider {
  if (value === undefined || value === null || value === "" || value === DEFAULT_TTS_PROVIDER) {
    return DEFAULT_TTS_PROVIDER;
  }
  throw new LocalAudioConfigError("tts_provider must be builtin-piper");
}

function normalizeCapability(value: unknown): LocalSpeechCapability {
  if (value === undefined || value === null || value === "" || value === "asr" || value === "speech-to-text") {
    return "speech-to-text";
  }
  if (value === "tts" || value === "text-to-speech") {
    return "text-to-speech";
  }
  throw new LocalAudioConfigError("capability must be speech-to-text or text-to-speech");
}

function normalizeEnabled(value: unknown): boolean {
  return value === true;
}

function defaultConfig(): LocalAudioConfigFile {
  return {
    version: 2,
    asrEnabled: false,
    asrProvider: DEFAULT_ASR_PROVIDER,
    asrBaseUrl: null,
    asrApiKey: null,
    asrModel: DEFAULT_ASR_MODEL,
    ttsEnabled: false,
    ttsProvider: DEFAULT_TTS_PROVIDER,
    ttsModel: DEFAULT_TTS_MODEL,
    updatedAt: new Date(0).toISOString(),
  };
}

function setupStatus(enabled: boolean, builtinStatus: BuiltinFunAsrStatus): LocalSpeechSetupStatus {
  if (!enabled) return "disabled";
  return builtinStatus.available ? "ready" : "needs-install";
}

async function publicConfig(
  config: LocalAudioConfigFile,
  asrStatus: BuiltinFunAsrStatus,
  ttsStatus: BuiltinFunAsrStatus,
): Promise<PublicLocalAudioConfig> {
  const asrSetupStatus = setupStatus(config.asrEnabled, asrStatus);
  const ttsSetupStatus = setupStatus(config.ttsEnabled, ttsStatus);
  return {
    asr: {
      capability: "speech-to-text",
      enabled: config.asrEnabled,
      provider: DEFAULT_ASR_PROVIDER,
      base_url: null,
      model: config.asrModel,
      has_api_key: false,
      ready: asrSetupStatus === "ready",
      setup: {
        provider: "funasr",
        runtime: "builtin-rpc",
        status: asrSetupStatus,
        available: asrStatus.available,
        default_base_url: null,
        commands: [],
        ...(asrStatus.message ? { message: asrStatus.message } : {}),
      },
    },
    tts: {
      capability: "text-to-speech",
      enabled: config.ttsEnabled,
      provider: DEFAULT_TTS_PROVIDER,
      base_url: null,
      model: config.ttsModel,
      has_api_key: false,
      ready: ttsSetupStatus === "ready",
      setup: {
        provider: "piper",
        runtime: "builtin-rpc",
        status: ttsSetupStatus,
        available: ttsStatus.available,
        default_base_url: null,
        commands: [],
        ...(ttsStatus.message ? { message: ttsStatus.message } : {}),
      },
    },
  };
}

async function readState(
  config: LocalAudioConfigFile,
  asrStatus: BuiltinFunAsrStatus,
  ttsStatus: BuiltinFunAsrStatus,
): Promise<LocalAudioConfigReadState> {
  return {
    ...(await publicConfig(config, asrStatus, ttsStatus)),
    updated_at: config.updatedAt,
  };
}

async function readLegacyConfig(store: SqliteLocalConfigStore): Promise<LocalAudioConfigFile | null> {
  const data = await store.getJson<Partial<LocalAudioConfigFile>>(LOCAL_AUDIO_CONFIG_KEY);
  if (!data) return null;
  return {
    version: 2,
    asrEnabled: data.asrEnabled === true,
    asrProvider: normalizeProvider(data.asrProvider),
    asrBaseUrl: null,
    asrApiKey: null,
    asrModel: normalizeModel(data.asrModel, DEFAULT_ASR_MODEL),
    ttsEnabled: data.ttsEnabled === true,
    ttsProvider: normalizeTtsProvider(data.ttsProvider),
    ttsModel: normalizeModel(data.ttsModel, DEFAULT_TTS_MODEL),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date(0).toISOString(),
  };
}

function normalizeYamlAudioConfig(value: unknown): LocalAudioConfigFile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const asr = record.asr && typeof record.asr === "object" && !Array.isArray(record.asr)
    ? record.asr as Record<string, unknown>
    : {};
  const tts = record.tts && typeof record.tts === "object" && !Array.isArray(record.tts)
    ? record.tts as Record<string, unknown>
    : {};
  return {
    version: 2,
    asrEnabled: asr.enabled === true,
    asrProvider: normalizeProvider(asr.provider),
    asrBaseUrl: null,
    asrApiKey: null,
    asrModel: normalizeModel(asr.model, DEFAULT_ASR_MODEL),
    ttsEnabled: tts.enabled === true,
    ttsProvider: normalizeTtsProvider(tts.provider),
    ttsModel: normalizeModel(tts.model, DEFAULT_TTS_MODEL),
    updatedAt: typeof record.updated_at === "string"
      ? record.updated_at
      : new Date(0).toISOString(),
  };
}

function yamlAudioConfig(config: LocalAudioConfigFile): Record<string, unknown> {
  return {
    asr: {
      enabled: config.asrEnabled,
      provider: config.asrProvider,
      model: config.asrModel,
    },
    tts: {
      enabled: config.ttsEnabled,
      provider: config.ttsProvider,
      model: config.ttsModel,
    },
    updated_at: config.updatedAt,
  };
}

async function writeConfig(store: ClashUserConfigStore, config: LocalAudioConfigFile): Promise<void> {
  await store.setSection("audio", yamlAudioConfig(config));
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
  cacheDir: string,
): LocalAsrRuntimePort | null {
  if (!options.builtinStatus && !options.builtinInstall && !options.builtinTranscribe) return null;
  const fallback = createPythonLocalAsrRuntime({
    pythonBinary,
    pythonPath: defaultClashSdkPythonPath(),
    cacheDir,
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

function createDefaultAsrRuntime(
  options: LocalAudioConfigStoreOptions,
  pythonBinary: string,
  cacheDir: string,
): LocalAsrRuntimePort {
  return options.asrRuntime
    ?? createHookBackedRuntime(options, pythonBinary, cacheDir)
    ?? createPythonLocalAsrRuntime({
      pythonBinary,
      pythonPath: defaultClashSdkPythonPath(),
      cacheDir,
    });
}

function createDefaultTtsRuntime(
  options: LocalAudioConfigStoreOptions,
  pythonBinary: string,
  cacheDir: string,
): LocalTtsRuntimePort {
  return options.ttsRuntime
    ?? createPythonLocalTtsRuntime({
      pythonBinary,
      pythonPath: defaultClashSdkPythonPath(),
      cacheDir,
    });
}

async function transcribeWithRuntime(
  runtime: LocalAsrRuntimePort,
  input: { file: File; language?: string | null },
  model: string,
): Promise<LocalAsrTranscription> {
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
  const configStore = createClashUserConfigStore(options.dataDir);
  const legacyStore = createSqliteLocalConfigStore(options.dataDir);
  const pythonBinary = options.pythonBinary ?? DEFAULT_PYTHON_BINARY;
  const asrCacheDir = join(options.dataDir, "models", "speech", "asr");
  const asrRuntime = createDefaultAsrRuntime(options, pythonBinary, asrCacheDir);
  const ttsCacheDir = join(options.dataDir, "models", "speech", "tts");
  const ttsRuntime = createDefaultTtsRuntime(options, pythonBinary, ttsCacheDir);

  let migration: Promise<void> | null = null;
  async function ensureMigrated(): Promise<void> {
    migration ??= (async () => {
      if (normalizeYamlAudioConfig(await configStore.getSection("audio"))) return;
      const legacy = await readLegacyConfig(legacyStore);
      if (!legacy) return;
      await writeConfig(configStore, legacy);
      await legacyStore.delete(LOCAL_AUDIO_CONFIG_KEY);
    })();
    return migration;
  }

  async function current(): Promise<LocalAudioConfigFile> {
    await ensureMigrated();
    return normalizeYamlAudioConfig(await configStore.getSection("audio")) ?? defaultConfig();
  }

  async function currentAsrStatus(model: string): Promise<LocalModelStatus> {
    try {
      return await asrRuntime.status({ model, cacheDir: asrCacheDir });
    } catch (error) {
      return { available: false, message: displayErrorMessage(error) };
    }
  }

  async function currentTtsStatus(model: string): Promise<LocalModelStatus> {
    try {
      return await ttsRuntime.status({ model, cacheDir: ttsCacheDir });
    } catch (error) {
      return { available: false, message: displayErrorMessage(error) };
    }
  }

  async function currentPublicConfig(config: LocalAudioConfigFile): Promise<PublicLocalAudioConfig> {
    const [asrStatus, ttsStatus] = await Promise.all([
      currentAsrStatus(config.asrModel),
      currentTtsStatus(config.ttsModel),
    ]);
    return publicConfig(config, asrStatus, ttsStatus);
  }

  async function currentReadState(config: LocalAudioConfigFile): Promise<LocalAudioConfigReadState> {
    const [asrStatus, ttsStatus] = await Promise.all([
      currentAsrStatus(config.asrModel),
      currentTtsStatus(config.ttsModel),
    ]);
    return readState(config, asrStatus, ttsStatus);
  }

  return {
    async getPublicConfig() {
      const config = await current();
      return currentPublicConfig(config);
    },

    async getReadState() {
      const config = await current();
      return currentReadState(config);
    },

    async getModelStatus(input) {
      const capability = normalizeCapability(input.capability);
      const config = await current();
      const defaultModel = capability === "text-to-speech" ? config.ttsModel : config.asrModel;
      const model = normalizeModel(input.model, defaultModel);
      const status = capability === "text-to-speech"
        ? await currentTtsStatus(model)
        : await currentAsrStatus(model);
      return {
        capability,
        model,
        available: status.available,
        ...(status.message ? { message: status.message } : {}),
      };
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
        ? normalizeModel(input.asr_model, DEFAULT_ASR_MODEL)
        : existing.asrModel;
      const ttsEnabled = Object.prototype.hasOwnProperty.call(input, "tts_enabled")
        ? normalizeEnabled(input.tts_enabled)
        : existing.ttsEnabled;
      const ttsProvider = Object.prototype.hasOwnProperty.call(input, "tts_provider")
        ? normalizeTtsProvider(input.tts_provider)
        : DEFAULT_TTS_PROVIDER;
      const ttsModel = Object.prototype.hasOwnProperty.call(input, "tts_model")
        ? normalizeModel(input.tts_model, DEFAULT_TTS_MODEL)
        : existing.ttsModel;

      const next: LocalAudioConfigFile = {
        version: 2,
        asrEnabled: enabled,
        asrProvider: provider,
        asrBaseUrl: null,
        asrApiKey: null,
        asrModel: model,
        ttsEnabled,
        ttsProvider,
        ttsModel,
        updatedAt: new Date().toISOString(),
      };
      await writeConfig(configStore, next);
      return currentPublicConfig(next);
    },

    async installBuiltin(input = {}) {
      const config = await current();
      const capability = normalizeCapability(input.capability);
      const defaultModel = capability === "text-to-speech" ? config.ttsModel : config.asrModel;
      const model = Object.prototype.hasOwnProperty.call(input, "model")
        ? normalizeModel(input.model, defaultModel)
        : defaultModel;
      try {
        if (capability === "text-to-speech") {
          await ttsRuntime.deploy({ model, kind: "tts", cacheDir: ttsCacheDir });
        } else {
          await asrRuntime.deploy({ model, kind: "asr", cacheDir: asrCacheDir });
        }
        const deployedStatus = capability === "text-to-speech"
          ? await currentTtsStatus(model)
          : await currentAsrStatus(model);
        if (!deployedStatus.available) {
          throw new LocalAudioConfigError(
            `Local ${capability === "text-to-speech" ? "TTS" : "ASR"} model did not become ready after install.${deployedStatus.message ? ` ${deployedStatus.message}` : ""}`,
            502,
          );
        }
      } catch (error) {
        if (error instanceof LocalAudioConfigError) throw error;
        const label = capability === "text-to-speech" ? "TTS" : "ASR";
        throw new LocalAudioConfigError(`Local ${label} deploy failed: ${displayErrorMessage(error)}`, 502);
      }
      const next: LocalAudioConfigFile = {
        ...config,
        ...(capability === "text-to-speech"
          ? {
              ttsProvider: DEFAULT_TTS_PROVIDER,
              ttsModel: model,
            }
          : {
              asrProvider: DEFAULT_ASR_PROVIDER,
              asrBaseUrl: null,
              asrApiKey: null,
              asrModel: model,
            }),
        updatedAt: new Date().toISOString(),
      };
      await writeConfig(configStore, next);
      return currentPublicConfig(next);
    },

    async removeBuiltin(input) {
      const config = await current();
      const capability = normalizeCapability(input.capability);
      const defaultModel = capability === "text-to-speech" ? config.ttsModel : config.asrModel;
      const model = Object.prototype.hasOwnProperty.call(input, "model")
        ? normalizeModel(input.model, defaultModel)
        : defaultModel;
      try {
        if (capability === "text-to-speech") {
          await ttsRuntime.remove({ model, cacheDir: ttsCacheDir });
        } else if (asrRuntime.remove) {
          await asrRuntime.remove({ model, cacheDir: asrCacheDir });
        } else {
          throw new Error("Selected ASR runtime does not support removing cached models");
        }
      } catch (error) {
        if (error instanceof LocalAudioConfigError) throw error;
        const label = capability === "text-to-speech" ? "TTS" : "ASR";
        throw new LocalAudioConfigError(`Local ${label} removal failed: ${displayErrorMessage(error)}`, 502);
      }
      const next = {
        ...config,
        updatedAt: new Date().toISOString(),
      };
      await writeConfig(configStore, next);
      return currentPublicConfig(next);
    },

    async transcribe(input) {
      const config = await current();
      if (!config.asrEnabled) {
        throw new LocalAudioConfigError(
          "Local ASR is not enabled. Open Settings > Audio and enable voice input.",
          409,
        );
      }

      const status = await currentAsrStatus(config.asrModel);
      if (!status.available) {
        throw new LocalAudioConfigError(
          `Selected ASR model is not deployed. Open Settings > Models and deploy it.${status.message ? ` ${status.message}.` : ""}`,
          409,
        );
      }
      return transcribeWithRuntime(asrRuntime, input, config.asrModel);
    },

    async synthesize(input) {
      if (!input.text.trim()) {
        throw new LocalAudioConfigError("Local TTS text is required");
      }
      const model = normalizeModel(input.model, DEFAULT_TTS_MODEL);
      const status = await currentTtsStatus(model);
      if (!status.available) {
        throw new LocalAudioConfigError(
          `Selected TTS model is not downloaded. Open Settings > Models and download it.${status.message ? ` ${status.message}.` : ""}`,
          409,
        );
      }

      const dir = await mkdtemp(join(tmpdir(), "clash-tts-"));
      const outputPath = join(dir, "speech.wav");
      try {
        const synthesis = await ttsRuntime.synthesize({
          model,
          text: input.text.trim(),
          outputPath,
          cacheDir: ttsCacheDir,
          voice: input.voice,
          speed: input.speed,
        });
        const { outputPath: _outputPath, ...metadata } = synthesis;
        return {
          audio: new Uint8Array(await readFile(outputPath)),
          metadata,
        };
      } catch (error) {
        if (error instanceof LocalAudioConfigError) throw error;
        throw new LocalAudioConfigError(`Local TTS synthesis failed: ${displayErrorMessage(error)}`, 502);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
