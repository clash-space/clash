import { join, resolve } from "node:path";

export interface WebDistPathInput {
  envWebDistDir?: string;
  isPackaged: boolean;
  moduleDir: string;
  resourcesPath: string;
}

export function resolveWebDistDir(input: WebDistPathInput): string {
  if (input.envWebDistDir) return input.envWebDistDir;
  if (input.isPackaged) return join(input.resourcesPath, "web-dist");
  return resolve(input.moduleDir, "../../web/dist/client");
}
