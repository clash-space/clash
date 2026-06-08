import { execFileSync } from "node:child_process";
import { homedir } from "node:os";

export interface ResolveMacGuiPathInput {
  env: Record<string, string | undefined>;
  homeDir: string;
  platform: NodeJS.Platform | string;
  readLoginShellPath?: () => string;
}

const FINDER_DEFAULT_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

function commonMacUserPaths(homeDir: string): string[] {
  return [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    `${homeDir}/.local/bin`,
    `${homeDir}/.npm-global/bin`,
    `${homeDir}/.pnpm`,
    `${homeDir}/.bun/bin`,
    `${homeDir}/.cargo/bin`,
  ];
}

function splitPath(value: string | undefined): string[] {
  return (value ?? "")
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);
}

function uniquePath(parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    if (seen.has(part)) continue;
    seen.add(part);
    out.push(part);
  }
  return out.join(":");
}

export function readMacLoginShellPath(env: Record<string, string | undefined> = process.env): string {
  const shell = env.SHELL || "/bin/zsh";
  try {
    return execFileSync(shell, ["-lc", "printf %s \"$PATH\""], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export function resolveMacGuiPath(input: ResolveMacGuiPathInput): string {
  const current = input.env.PATH ?? "";
  if (input.platform !== "darwin") return current;

  const loginShellPath = input.readLoginShellPath?.() ?? readMacLoginShellPath(input.env);
  return uniquePath([
    ...splitPath(loginShellPath),
    ...commonMacUserPaths(input.homeDir),
    ...splitPath(current),
    ...splitPath(FINDER_DEFAULT_PATH),
  ]);
}

export function hydrateMacGuiPath(env: NodeJS.ProcessEnv = process.env): void {
  if (process.platform !== "darwin") return;
  env.PATH = resolveMacGuiPath({
    env,
    homeDir: homedir(),
    platform: process.platform,
  });
}
