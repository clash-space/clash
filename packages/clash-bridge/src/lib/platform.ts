/**
 * OS-specific paths for daemon state, logs, and service files.
 *
 * macOS pattern follows Apple's "App Sandbox / Application Support" guidance
 * (Library/Application Support for state, Library/Logs for log files,
 * Library/LaunchAgents for user service plists).
 *
 * Linux follows XDG Base Directory: ~/.config for config, ~/.local/state
 * for runtime state, ~/.config/systemd/user for user units.
 *
 * Windows isn't supported in v1 — daemon mode is gated to macOS/linux.
 * The launchd self-install logic refuses to run on win32 with a clear
 * "use --foreground for now" message.
 */

import { homedir, platform } from "node:os";
import { join } from "node:path";

export type Platform = "darwin" | "linux" | "win32" | "unknown";

export function currentPlatform(): Platform {
  const p = platform();
  if (p === "darwin" || p === "linux" || p === "win32") return p;
  return "unknown";
}

export interface Paths {
  /** ~/.config/clash on linux; ~/Library/Application Support/clash on macOS. */
  configDir: string;
  /** Credentials file (server_url, runtime_id, token, machine_id). */
  credsFile: string;
  /** Stable per-user machine fingerprint; persisted on first run. */
  machineIdFile: string;
  /** Daemon log file. */
  logFile: string;
  /** launchd plist (macOS) / systemd user unit (linux). null on win32. */
  serviceFile: string | null;
  /** Service identifier — reverse-DNS style. */
  serviceLabel: string;
}

const SERVICE_LABEL = "space.clash.bridge";

export function paths(): Paths {
  const home = homedir();
  const p = currentPlatform();
  if (p === "darwin") {
    const configDir = join(home, "Library", "Application Support", "clash");
    return {
      configDir,
      credsFile: join(configDir, "credentials.json"),
      machineIdFile: join(configDir, "machine-id"),
      logFile: join(home, "Library", "Logs", "clash", "bridge.log"),
      serviceFile: join(home, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`),
      serviceLabel: SERVICE_LABEL,
    };
  }
  if (p === "linux") {
    const configDir = process.env.XDG_CONFIG_HOME
      ? join(process.env.XDG_CONFIG_HOME, "clash")
      : join(home, ".config", "clash");
    const stateDir = process.env.XDG_STATE_HOME
      ? join(process.env.XDG_STATE_HOME, "clash")
      : join(home, ".local", "state", "clash");
    return {
      configDir,
      credsFile: join(configDir, "credentials.json"),
      machineIdFile: join(configDir, "machine-id"),
      logFile: join(stateDir, "bridge.log"),
      serviceFile: join(home, ".config", "systemd", "user", `${SERVICE_LABEL}.service`),
      serviceLabel: SERVICE_LABEL,
    };
  }
  // win32 / unknown — no service file. Daemon can still run in foreground.
  const configDir = join(home, ".clash");
  return {
    configDir,
    credsFile: join(configDir, "credentials.json"),
    machineIdFile: join(configDir, "machine-id"),
    logFile: join(configDir, "bridge.log"),
    serviceFile: null,
    serviceLabel: SERVICE_LABEL,
  };
}

/** "darwin/arm64" — sent to server as the runtime's `os` field. */
export function osTag(): string {
  return `${platform()}/${process.arch}`;
}
