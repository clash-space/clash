import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".clash");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface ClashConfig {
  apiKey?: string;
  serverUrl?: string;
}

export function loadConfig(): ClashConfig {
  try {
    if (!existsSync(CONFIG_FILE)) return {};
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw) as ClashConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: ClashConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
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

export function requireApiKey(): string {
  const key = getApiKey();
  if (!key) {
    console.error(
      "Error: No API key configured.\n" +
      "Set CLASH_API_KEY env var or run: clash auth login"
    );
    process.exit(1);
  }
  return key;
}
