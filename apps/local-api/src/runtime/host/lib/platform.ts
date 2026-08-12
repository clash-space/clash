/**
 * OS paths for local host state and per-project cwd.
 *
 * Single convention across platforms: `~/.clash/` is the user-level root,
 * matching every other modern AI tool (`~/.claude`, `~/.codex`, `~/.gemini`,
 * `~/.cursor`). XDG and Library/Application-Support paths were noisier and
 * inconsistent; the one downside (slightly less Linux-purist) is acceptable.
 *
 */

import { execSync } from "node:child_process";
import { homedir, hostname as osHostname, platform } from "node:os";
import { join, resolve } from "node:path";

export interface Paths {
  /** `~/.clash` — root of all local host state on every platform. */
  configDir: string;
  /** Local project roots. ACP agents run here; sessions do not own cwd. */
  projectsDir: string;
}

export function paths(): Paths {
  const home = homedir();
  const clashHome = process.env.CLASH_HOME?.trim();
  const configDir = clashHome ? resolve(clashHome) : join(home, ".clash");
  const projectsDir = join(configDir, "projects");
  return { configDir, projectsDir };
}

/** "darwin/arm64" — advertised as the local runtime's operating-system tag. */
export function osTag(): string {
  return `${platform()}/${process.arch}`;
}

/** Resolve a useful user-facing machine name for local ACP sessions. */
export function machineName(): string {
  const currentPlatform = platform();
  const candidates: Array<() => string | undefined> = [];
  if (currentPlatform === "darwin") {
    candidates.push(() => execSync("scutil --get ComputerName", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    }).toString().trim());
  } else if (currentPlatform === "linux") {
    candidates.push(() => execSync("hostnamectl --pretty", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    }).toString().trim());
  }
  candidates.push(() => osHostname());

  for (const tryCandidate of candidates) {
    try {
      const value = tryCandidate();
      if (value && value.toLowerCase() !== "localhost") return value;
    } catch {
      // Try the next platform-specific source.
    }
  }
  const user = process.env.USER || process.env.USERNAME || "user";
  return `${user}'s ${currentPlatform === "darwin" ? "Mac" : currentPlatform === "linux" ? "Linux box" : "computer"}`;
}
