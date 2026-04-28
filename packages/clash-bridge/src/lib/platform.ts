/**
 * OS paths for daemon state, logs, service files, and per-session cwd.
 *
 * Single convention across platforms: `~/.clash/` is the user-level root,
 * matching every other modern AI tool (`~/.claude`, `~/.codex`, `~/.gemini`,
 * `~/.cursor`). XDG and Library/Application-Support paths were noisier and
 * inconsistent; the one downside (slightly less Linux-purist) is acceptable.
 *
 * Service files (launchd plist / systemd user unit) stay in their
 * platform-canonical locations because the OS scans those directories —
 * we can't move them.
 *
 * Windows isn't supported in v1 for service mode — daemon command still
 * runs in foreground; users wire their own startup later.
 */

import { homedir, platform, hostname as osHostname } from "node:os";
import { execSync } from "node:child_process";
import { join } from "node:path";

export type Platform = "darwin" | "linux" | "win32" | "unknown";

export function currentPlatform(): Platform {
  const p = platform();
  if (p === "darwin" || p === "linux" || p === "win32") return p;
  return "unknown";
}

export interface Paths {
  /** `~/.clash` — root of all daemon state on every platform. */
  configDir: string;
  /** Credentials file (server_url, runtime_id, token, machine_id). */
  credsFile: string;
  /** Stable per-user machine fingerprint; persisted on first run. */
  machineIdFile: string;
  /** Daemon log file. */
  logFile: string;
  /** Per-session cwd root. Each spawned ACP agent gets a subdir under this. */
  sessionsDir: string;
  /** launchd plist (macOS) / systemd user unit (linux). null on win32. */
  serviceFile: string | null;
  /** Service identifier — reverse-DNS style. */
  serviceLabel: string;
}

const SERVICE_LABEL = "space.clash.bridge";

export function paths(): Paths {
  const home = homedir();
  const p = currentPlatform();
  const configDir = join(home, ".clash");
  const credsFile = join(configDir, "credentials.json");
  const machineIdFile = join(configDir, "machine-id");
  const sessionsDir = join(configDir, "sessions");
  const logFile = join(configDir, "logs", "bridge.log");

  let serviceFile: string | null = null;
  if (p === "darwin") {
    serviceFile = join(home, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
  } else if (p === "linux") {
    serviceFile = join(home, ".config", "systemd", "user", `${SERVICE_LABEL}.service`);
  }
  return { configDir, credsFile, machineIdFile, sessionsDir, logFile, serviceFile, serviceLabel: SERVICE_LABEL };
}

/** "darwin/arm64" — sent to server as the runtime's `os` field. */
export function osTag(): string {
  return `${platform()}/${process.arch}`;
}

/**
 * User-visible machine name for the runtime list.
 *
 * `os.hostname()` is unreliable on macOS — Sequoia and later return
 * `localhost` for many users because the system's HostName setting is
 * only auto-populated for machines on a managed network. The actual
 * user-facing label ("Xiaoyang's MacBook Pro") lives in ComputerName.
 *
 * Fall through:
 *   macOS  →  `scutil --get ComputerName`     (e.g. "Xiaoyang's MacBook Pro")
 *   linux  →  `hostnamectl --pretty`           (e.g. "xiaoyang-thinkpad")
 *   any    →  os.hostname()                    (last resort)
 *
 * If everything fails or returns `localhost`, returns the user's login
 * name + the OS — better than misleading "localhost" in the runtime list.
 */
export function machineName(): string {
  const p = currentPlatform();
  const candidates: Array<() => string | undefined> = [];
  if (p === "darwin") {
    candidates.push(() => execSync("scutil --get ComputerName", { stdio: ["ignore", "pipe", "ignore"], timeout: 1000 }).toString().trim());
  } else if (p === "linux") {
    candidates.push(() => execSync("hostnamectl --pretty", { stdio: ["ignore", "pipe", "ignore"], timeout: 1000 }).toString().trim());
  }
  candidates.push(() => osHostname());

  for (const tryFn of candidates) {
    try {
      const v = tryFn();
      if (v && v.toLowerCase() !== "localhost") return v;
    } catch { /* try next */ }
  }
  // Genuine fallback so the picker never shows "localhost".
  const user = process.env.USER || process.env.USERNAME || "user";
  return `${user}'s ${p === "darwin" ? "Mac" : p === "linux" ? "Linux box" : "computer"}`;
}
