import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createHttpRemoteLoroPersistence,
  type RemoteLoroPersistence,
  type RemoteLoroPersistenceEnv,
} from "./sync.js";
import { createHttpRemoteRoomSync, type RemoteRoomSync } from "./room-sync.js";

export type LocalSyncMode = "local-only" | "cloud-sync";
export type RemoteLoroSource = "none" | "env" | "config";

export interface PublicLocalSyncConfig {
  mode: LocalSyncMode;
  remote_loro: {
    enabled: boolean;
    url: string | null;
    has_token: boolean;
    source: RemoteLoroSource;
  };
}

export interface LocalSyncConfigStore {
  getPublicConfig(): Promise<PublicLocalSyncConfig>;
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
  updatedAt: string;
}

interface EffectiveLocalSyncConfig {
  mode: LocalSyncMode;
  remoteLoroUrl: string | null;
  remoteLoroToken: string | null;
  source: RemoteLoroSource;
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

function envConfig(env: RemoteLoroPersistenceEnv | undefined): EffectiveLocalSyncConfig {
  const url = normalizeRemoteUrl(env?.CLASH_REMOTE_LORO_URL);
  return {
    mode: url ? "cloud-sync" : "local-only",
    remoteLoroUrl: url,
    remoteLoroToken: trimToNull(env?.CLASH_REMOTE_LORO_TOKEN),
    source: url ? "env" : "none",
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
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

async function writeConfigFile(path: string, config: LocalSyncConfigFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2), "utf8");
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
      source: file.remoteLoroUrl ? "config" : "none",
    };
  }

  return {
    async getPublicConfig() {
      return toPublicConfig(await effective());
    },

    async updateFromRequest(input) {
      const current = (await readConfigFile(path)) ?? {
        version: 1 as const,
        mode: envConfig(env).mode,
        remoteLoroUrl: envConfig(env).remoteLoroUrl,
        remoteLoroToken: null,
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

      const next: LocalSyncConfigFile = {
        version: 1,
        mode,
        remoteLoroUrl: mode === "cloud-sync" ? remoteLoroUrl : null,
        remoteLoroToken: mode === "cloud-sync" ? remoteLoroToken : null,
        updatedAt: new Date().toISOString(),
      };
      await writeConfigFile(path, next);
      return toPublicConfig({
        mode: next.mode,
        remoteLoroUrl: next.remoteLoroUrl,
        remoteLoroToken: next.remoteLoroToken,
        source: next.remoteLoroUrl ? "config" : "none",
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
      if (config.mode !== "cloud-sync" || !config.remoteLoroUrl) return undefined;
      return createHttpRemoteRoomSync({
        baseUrl: config.remoteLoroUrl,
        token: config.remoteLoroToken ?? undefined,
        fetch: options.fetch,
      });
    },
  };
}
