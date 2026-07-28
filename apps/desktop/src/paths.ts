import { delimiter, dirname, join, resolve } from "node:path";

export interface WebDistPathInput {
  envWebDistDir?: string;
  isPackaged: boolean;
  moduleDir: string;
  resourcesPath: string;
}

export interface ClashCliEntryPathInput {
  isPackaged: boolean;
  moduleDir: string;
  resourcesPath: string;
}

export type AgentBundlePathInput = ClashCliEntryPathInput;

export interface ClashSdkPythonPathInput {
  envPythonSdkPath?: string;
  isPackaged: boolean;
  moduleDir: string;
  resourcesPath: string;
}

export interface DesktopStatePaths {
  root: string;
  userData: string;
  sessionData: string;
  logs: string;
  crashDumps: string;
}

export function resolveDesktopStatePaths(localApiDataDir: string): DesktopStatePaths {
  const clashHome = dirname(resolve(localApiDataDir));
  const root = join(clashHome, "desktop");
  return {
    root,
    userData: join(root, "user-data"),
    sessionData: join(root, "session-data"),
    logs: join(clashHome, "logs", "desktop"),
    crashDumps: join(root, "crash-dumps"),
  };
}

export function resolveWebDistDir(input: WebDistPathInput): string {
  if (input.envWebDistDir) return input.envWebDistDir;
  if (input.isPackaged) return join(input.resourcesPath, "web-dist");
  return resolve(input.moduleDir, "../../web/dist/client");
}

export function resolveAcpBinDir(dataDir: string): string {
  return join(dataDir, "acp-bin");
}

export function resolveAgentBundleRoot(input: AgentBundlePathInput): string {
  if (input.isPackaged) return join(input.resourcesPath, "agents");
  return resolve(input.moduleDir, "../../../packages/clash-bridge/dist/agents");
}

export function resolveClashCliEntryPath(input: ClashCliEntryPathInput): string {
  if (input.isPackaged) return join(input.resourcesPath, "clash-cli", "dist", "index.js");
  return resolve(input.moduleDir, "../../../packages/cli/dist/index.js");
}

export function resolveClashCliNodePath(input: ClashCliEntryPathInput): string | undefined {
  if (input.isPackaged) return join(input.resourcesPath, "clash-cli", "vendor");
  return undefined;
}

export function resolveClashSdkPythonPath(input: ClashSdkPythonPathInput): string {
  if (input.envPythonSdkPath) return input.envPythonSdkPath;
  if (input.isPackaged) return join(input.resourcesPath, "clash-sdk", "python");
  return resolve(input.moduleDir, "../../../packages/clash-sdk/python");
}

export function prependPythonPath(existing: string | undefined, sdkPath: string): string {
  return [sdkPath, ...(existing?.split(delimiter) ?? [])]
    .filter((entry, index, entries) => entry && entries.indexOf(entry) === index)
    .join(delimiter);
}
