import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { serveDirectorPluginStdio } from "./server.js";

export * from "./adapter.js";
export * from "./app.js";
export * from "./contract.js";
export * from "./server.js";

export function isDirectExecution(moduleUrl: string, argvEntry = process.argv[1], cwd = process.cwd()): boolean {
  return Boolean(argvEntry && pathToFileURL(resolve(cwd, argvEntry)).href === moduleUrl);
}

if (isDirectExecution(import.meta.url)) await serveDirectorPluginStdio();
