import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { LocalProviderAccountConfig } from "./provider-accounts.js";
import { createLocalProviderStore } from "./local-provider-store.js";

export interface ProviderLiveTestConfig {
  mode: "replay" | "live";
  configPath?: string;
  env: Record<string, string>;
}

export const DEFAULT_PROVIDER_E2E_TIMEOUT_MS = 30 * 60_000;

/** Total lifetime for one live Provider case, configurable from env or the JSON config env map. */
export function providerLiveTestTimeoutMs(
  config: Pick<ProviderLiveTestConfig, "env">,
): number {
  const raw = config.env.CLASH_PROVIDER_E2E_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_PROVIDER_E2E_TIMEOUT_MS;
  const timeoutMs = Number(raw);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("CLASH_PROVIDER_E2E_TIMEOUT_MS must be a positive integer");
  }
  return timeoutMs;
}

/**
 * Test-only: loads credentials only for explicitly opted-in live Vitest runs. Default
 * test execution ignores machine credentials and remains offline replay.
 */
export async function loadProviderLiveTestConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderLiveTestConfig> {
  const requestedMode = env.CLASH_PROVIDER_E2E?.trim();
  if (
    requestedMode !== undefined &&
    requestedMode !== "" &&
    requestedMode !== "live"
  ) {
    throw new Error("CLASH_PROVIDER_E2E must be 'live' when set");
  }
  if (requestedMode !== "live") return { mode: "replay", env: {} };

  const configuredPath = env.CLASH_PROVIDER_E2E_CONFIG?.trim();
  let configEnv: Record<string, string> = {};
  let configPath: string | undefined;
  if (configuredPath) {
    configPath = resolve(configuredPath);
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    configEnv = parseProviderLiveTestConfig(parsed, configPath);
  }

  const processEnv = Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  return {
    mode: "live",
    ...(configPath ? { configPath } : {}),
    env: { ...configEnv, ...processEnv },
  };
}

export async function loadProviderLiveTestLocalAccount(
  config: ProviderLiveTestConfig,
  options: {
    accountIdEnv: string;
    matches: (account: LocalProviderAccountConfig) => boolean;
    loadAccounts?: (dataDir: string) => Promise<LocalProviderAccountConfig[]>;
  },
): Promise<LocalProviderAccountConfig | undefined> {
  // This is deliberately a second live gate rather than relying on the caller. Importing a live
  // test helper during ordinary Vitest collection must never inspect ~/.clash or initialize a DB.
  if (config.mode !== "live") return undefined;
  const configuredDataDir =
    config.env.CLASH_PROVIDER_E2E_LOCAL_DATA_DIR?.trim();
  if (!configuredDataDir) return undefined;

  const dataDir = resolve(configuredDataDir);
  const loadAccounts =
    options.loadAccounts ??
    ((directory: string) =>
      createLocalProviderStore(directory).loadProviderAccounts());
  const candidates = (await loadAccounts(dataDir)).filter(
    (account) => account.enabled && options.matches(account),
  );
  const selectedId =
    config.env[options.accountIdEnv]?.trim() ||
    config.env.CLASH_PROVIDER_E2E_LOCAL_ACCOUNT_ID?.trim();
  if (selectedId) {
    const selected = candidates.find((account) => account.id === selectedId);
    if (!selected) {
      throw new Error(
        `${options.accountIdEnv}=${selectedId} is not an enabled matching account in ${dataDir}`,
      );
    }
    return selected;
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    throw new Error(
      `No enabled matching provider account exists in ${dataDir}`,
    );
  }
  throw new Error(
    `${dataDir} has multiple matching accounts (${candidates
      .map((account) => account.id ?? "unnamed")
      .join(", ")}); set ${options.accountIdEnv}`,
  );
}

function parseProviderLiveTestConfig(
  value: unknown,
  path: string,
): Record<string, string> {
  if (!isObject(value) || !isObject(value.env)) {
    throw new Error(
      `Provider live test config ${path} must contain an env object`,
    );
  }
  const entries = Object.entries(value.env);
  if (entries.some(([, candidate]) => typeof candidate !== "string")) {
    throw new Error(
      `Provider live test config ${path} env values must be strings`,
    );
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
