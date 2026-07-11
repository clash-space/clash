import { chmodSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveClashRoot } from "./clash-home";

export function configDir(env: Record<string, string | undefined> = process.env): string {
  return resolveClashRoot(env);
}

export function configFilePath(env: Record<string, string | undefined> = process.env): string {
  return join(configDir(env), "config.json");
}

export interface ClashConfig {
  apiKey?: string;
  serverUrl?: string;
}

export function loadConfig(): ClashConfig {
  const path = configFilePath();
  try {
    if (!existsSync(path)) return {};
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as ClashConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: ClashConfig): void {
  const dir = configDir();
  const path = configFilePath();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
  chmodSync(path, 0o600);
}

/**
 * Get API key from env var (priority) or config file.
 */
export function getApiKey(): string | undefined {
  return process.env.CLASH_API_KEY || loadConfig().apiKey;
}

/**
 * Get server URL from env var or config file. Defaults to localhost for dev.
 */
export function getServerUrl(): string {
  return (
    process.env.CLASH_API_URL ||
    loadConfig().serverUrl ||
    "http://localhost:8788"
  );
}

function isLoopbackServerUrl(serverUrl: string): boolean {
  try {
    const hostname = new URL(serverUrl).hostname.toLowerCase();
    return hostname === "127.0.0.1" ||
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname === "[::1]";
  } catch {
    return false;
  }
}

export function requireApiKey(serverUrl = getServerUrl()): string {
  const key = getApiKey();
  if (!key && isLoopbackServerUrl(serverUrl)) return "";
  if (!key) {
    console.error(
      "Error: Cloud sync requires authentication.\n" +
      "Run: clash auth login\n" +
      "Pure local projects work through a loopback local-api without cloud login."
    );
    process.exit(1);
  }
  return key;
}
