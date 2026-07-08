import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createHttpRemoteLoroPersistence,
  type RemoteLoroPersistence,
  type RemoteLoroPersistenceEnv,
} from "./sync.js";
import { createHttpRemoteRoomSync, type RemoteRoomSync } from "./room-sync.js";

export type LocalSyncMode = "local-only" | "cloud-sync";
export type RemoteLoroSource = "none" | "env" | "config";

export interface LocalSyncCapabilities {
  canvas: boolean;
  room: boolean;
  asset_metadata: boolean;
  revision_content: boolean;
}

export interface PublicLocalSyncConfig {
  mode: LocalSyncMode;
  remote_loro: {
    enabled: boolean;
    url: string | null;
    has_token: boolean;
    source: RemoteLoroSource;
  };
  capabilities: LocalSyncCapabilities;
}

export type LocalSyncConfigReadState = PublicLocalSyncConfig & {
  updated_at: string;
};

export interface LocalSyncConfigStore {
  getPublicConfig(): Promise<PublicLocalSyncConfig>;
  getReadState?(): Promise<LocalSyncConfigReadState>;
  updateFromRequest(input: Record<string, unknown>): Promise<PublicLocalSyncConfig>;
  resolveRemotePersistence(): Promise<RemoteLoroPersistence | undefined>;
  resolveRemoteRoomSync(): Promise<RemoteRoomSync | undefined>;
}

export class LocalSyncConfigError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

interface LocalSyncConfigFile {
  version: 1;
  mode: LocalSyncMode;
  remoteLoroUrl: string | null;
  remoteLoroToken: string | null;
  capabilities: LocalSyncCapabilities;
  updatedAt: string;
}

interface EffectiveLocalSyncConfig {
  mode: LocalSyncMode;
  remoteLoroUrl: string | null;
  remoteLoroToken: string | null;
  capabilities: LocalSyncCapabilities;
  source: RemoteLoroSource;
  updatedAt: string;
}

interface LocalSyncConfigStoreOptions {
  dataDir: string;
  env?: RemoteLoroPersistenceEnv;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

function configPath(dataDir: string): string {
  return join(dataDir, "sync.json");
}

function trimToNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRemoteUrl(value: unknown): string | null {
  const raw = trimToNull(value);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LocalSyncConfigError("remote_loro_url must be a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new LocalSyncConfigError("remote_loro_url must use http or https");
  }
  return raw.replace(/\/+$/, "");
}

function normalizeMode(value: unknown): LocalSyncMode {
  if (value === undefined || value === null) return "local-only";
  if (value === "local-only" || value === "cloud-sync") return value;
  throw new LocalSyncConfigError("mode must be local-only or cloud-sync");
}

function defaultSyncCapabilities(): LocalSyncCapabilities {
  return {
    canvas: false,
    room: false,
    asset_metadata: false,
    revision_content: false,
  };
}

function normalizeCapabilities(
  value: unknown,
  fallback: LocalSyncCapabilities = defaultSyncCapabilities(),
): LocalSyncCapabilities {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new LocalSyncConfigError("capabilities must be an object");
  }
  const record = value as Record<string, unknown>;
  return {
    canvas: record.canvas === undefined ? fallback.canvas : record.canvas === true,
    room: record.room === undefined ? fallback.room : record.room === true,
    asset_metadata: record.asset_metadata === undefined
      ? fallback.asset_metadata
      : record.asset_metadata === true,
    revision_content: record.revision_content === undefined
      ? fallback.revision_content
      : record.revision_content === true,
  };
}

function envConfig(env: RemoteLoroPersistenceEnv | undefined): EffectiveLocalSyncConfig {
  const url = normalizeRemoteUrl(env?.CLASH_REMOTE_LORO_URL);
  return {
    mode: url ? "cloud-sync" : "local-only",
    remoteLoroUrl: url,
    remoteLoroToken: trimToNull(env?.CLASH_REMOTE_LORO_TOKEN),
    capabilities: defaultSyncCapabilities(),
    source: url ? "env" : "none",
    updatedAt: "env",
  };
}

function toPublicConfig(config: EffectiveLocalSyncConfig): PublicLocalSyncConfig {
  const enabled = config.mode === "cloud-sync" && !!config.remoteLoroUrl;
  return {
    mode: enabled ? "cloud-sync" : "local-only",
    remote_loro: {
      enabled,
      url: enabled ? config.remoteLoroUrl : null,
      has_token: enabled && !!config.remoteLoroToken,
      source: enabled ? config.source : "none",
    },
    capabilities: enabled ? config.capabilities : defaultSyncCapabilities(),
  };
}

function toReadState(config: EffectiveLocalSyncConfig): LocalSyncConfigReadState {
  return {
    ...toPublicConfig(config),
    updated_at: config.updatedAt,
  };
}

async function readConfigFile(path: string): Promise<LocalSyncConfigFile | null> {
  try {
    const data = JSON.parse(await readFile(path, "utf8")) as Partial<LocalSyncConfigFile>;
    return {
      version: 1,
      mode: normalizeMode(data.mode),
      remoteLoroUrl: normalizeRemoteUrl(data.remoteLoroUrl),
      remoteLoroToken: trimToNull(data.remoteLoroToken),
      capabilities: normalizeCapabilities(data.capabilities),
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

async function writeConfigFile(path: string, config: LocalSyncConfigFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

export function createLocalSyncConfigStore(
  options: LocalSyncConfigStoreOptions,
): LocalSyncConfigStore {
  const path = configPath(options.dataDir);
  const env = options.env ?? {};

  async function effective(): Promise<EffectiveLocalSyncConfig> {
    const file = await readConfigFile(path);
    if (!file) return envConfig(env);
    return {
      mode: file.mode,
      remoteLoroUrl: file.remoteLoroUrl,
      remoteLoroToken: file.remoteLoroToken,
      capabilities: file.mode === "cloud-sync" ? file.capabilities : defaultSyncCapabilities(),
      source: file.remoteLoroUrl ? "config" : "none",
      updatedAt: file.updatedAt,
    };
  }

  return {
    async getPublicConfig() {
      return toPublicConfig(await effective());
    },

    async getReadState() {
      return toReadState(await effective());
    },

    async updateFromRequest(input) {
      const current = (await readConfigFile(path)) ?? {
        version: 1 as const,
        mode: envConfig(env).mode,
        remoteLoroUrl: envConfig(env).remoteLoroUrl,
        remoteLoroToken: null,
        capabilities: envConfig(env).capabilities,
        updatedAt: new Date(0).toISOString(),
      };

      const mode = input.mode === undefined ? current.mode : normalizeMode(input.mode);
      const remoteLoroUrl = Object.prototype.hasOwnProperty.call(input, "remote_loro_url")
        ? normalizeRemoteUrl(input.remote_loro_url)
        : current.remoteLoroUrl;
      const remoteLoroToken = Object.prototype.hasOwnProperty.call(input, "remote_loro_token")
        ? trimToNull(input.remote_loro_token)
        : current.remoteLoroToken;

      if (mode === "cloud-sync" && !remoteLoroUrl) {
        throw new LocalSyncConfigError("remote_loro_url is required for cloud-sync mode");
      }
      const capabilities = mode === "cloud-sync"
        ? normalizeCapabilities(input.capabilities, current.capabilities)
        : defaultSyncCapabilities();

      const next: LocalSyncConfigFile = {
        version: 1,
        mode,
        remoteLoroUrl: mode === "cloud-sync" ? remoteLoroUrl : null,
        remoteLoroToken: mode === "cloud-sync" ? remoteLoroToken : null,
        capabilities,
        updatedAt: new Date().toISOString(),
      };
      await writeConfigFile(path, next);
      return toPublicConfig({
        mode: next.mode,
        remoteLoroUrl: next.remoteLoroUrl,
        remoteLoroToken: next.remoteLoroToken,
        capabilities: next.capabilities,
        source: next.remoteLoroUrl ? "config" : "none",
        updatedAt: next.updatedAt,
      });
    },

    async resolveRemotePersistence() {
      const config = await effective();
      if (config.mode !== "cloud-sync" || !config.remoteLoroUrl) return undefined;
      return createHttpRemoteLoroPersistence({
        baseUrl: config.remoteLoroUrl,
        token: config.remoteLoroToken ?? undefined,
        fetch: options.fetch,
      });
    },

    async resolveRemoteRoomSync() {
      const config = await effective();
      if (config.mode !== "cloud-sync" || !config.remoteLoroUrl || config.capabilities.room !== true) {
        return undefined;
      }
      return createHttpRemoteRoomSync({
        baseUrl: config.remoteLoroUrl,
        token: config.remoteLoroToken ?? undefined,
        fetch: options.fetch,
      });
    },
  };
}
