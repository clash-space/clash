import { join, resolve } from "node:path";

export interface WebDistPathInput {
  envWebDistDir?: string;
  isPackaged: boolean;
  moduleDir: string;
  resourcesPath: string;
}

export interface AcpBinDirsInput {
  isPackaged: boolean;
  moduleDir: string;
  resourcesPath: string;
  dataDir: string;
}

export interface ClashCliEntryPathInput {
  isPackaged: boolean;
  moduleDir: string;
  resourcesPath: string;
}

export function resolveWebDistDir(input: WebDistPathInput): string {
  if (input.envWebDistDir) return input.envWebDistDir;
  if (input.isPackaged) return join(input.resourcesPath, "web-dist");
  return resolve(input.moduleDir, "../../web/dist/client");
}

export function resolveAcpBinDirs(input: AcpBinDirsInput): string[] {
  return [join(input.dataDir, "acp-bin")];
}

export function resolveClashCliEntryPath(input: ClashCliEntryPathInput): string {
  if (input.isPackaged) return join(input.resourcesPath, "clash-cli", "dist", "index.js");
  return resolve(input.moduleDir, "../../../packages/cli/dist/index.js");
}

export function resolveClashCliNodePath(input: ClashCliEntryPathInput): string | undefined {
  if (input.isPackaged) return join(input.resourcesPath, "clash-cli", "vendor");
  return undefined;
}
