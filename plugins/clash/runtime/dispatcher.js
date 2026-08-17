#!/usr/bin/env node

// src/dispatcher.ts
import { readFileSync, realpathSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
function resolveClashDistributionVersion(moduleUrl = import.meta.url) {
  const moduleDir = dirname(fileURLToPath(moduleUrl));
  for (const candidate of [
    { path: join(moduleDir, "..", "package.json"), nested: false },
    { path: join(moduleDir, "runtime-manifest.json"), nested: true }
  ]) {
    try {
      const value = JSON.parse(readFileSync(candidate.path, "utf8"));
      const version = candidate.nested ? value.package?.version : value.version;
      if (typeof version === "string" && version.trim()) return version.trim();
    } catch {
    }
  }
  return void 0;
}
function normalizeClashArgv(argv = process.argv) {
  const normalized = [...argv];
  let index = 2;
  while (index < normalized.length) {
    const argument = normalized[index];
    if (argument === "--profile") {
      index += 2;
      continue;
    }
    if (argument?.startsWith("--profile=")) {
      index += 1;
      continue;
    }
    break;
  }
  if (normalized[index] === "--") normalized.splice(index, 1);
  return normalized;
}
function selectClashEntrypoint(argv = process.argv) {
  const args = normalizeClashArgv(argv).slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--profile") {
      index += 1;
      continue;
    }
    if (argument?.startsWith("--profile=")) continue;
    return argument === "mcp" || argument === "openma-mcp" ? argument : "cli";
  }
  return "cli";
}
function useSourceRuntime() {
  return process.env.CLASH_SOURCE_RUNTIME === "1" || import.meta.url.endsWith("/src/dispatcher.ts");
}
var runtimeLoaders = {
  cli: async () => {
    if (useSourceRuntime()) {
      const { createPluginHostManager } = await import(new URL("./plugin-host.ts", import.meta.url).href);
      const host = await createPluginHostManager({
        startedBy: "cli"
      }).ensureHost();
      process.env.CLASH_API_URL = host.endpoint;
      await import(new URL("../../../packages/cli/src/index.ts", import.meta.url).href);
      return;
    }
    await import(new URL("./clash-cli.cjs", import.meta.url).href);
  },
  mcp: async () => {
    const sourceRuntime = useSourceRuntime();
    const runtime = await import(new URL(sourceRuntime ? "./index.ts" : "./index.js", import.meta.url).href);
    await runtime.serveClashPluginStdio(
      sourceRuntime ? {
        appBundles: {
          studio: "",
          canvas: "",
          timeline: "",
          director: ""
        }
      } : void 0
    );
  },
  "openma-mcp": async () => {
    const sourceRuntime = useSourceRuntime();
    const runtime = await import(new URL(sourceRuntime ? "./index.ts" : "./index.js", import.meta.url).href);
    await runtime.serveOpenMaPluginStdio();
  }
};
async function runClashEntrypoint(argv = process.argv, loaders = runtimeLoaders) {
  const normalizedArgv = normalizeClashArgv(argv);
  const args = normalizedArgv.slice(2);
  const profileIndex = args.indexOf("--profile");
  const explicitProfile = profileIndex >= 0 ? args[profileIndex + 1] : args.find((argument) => argument.startsWith("--profile="))?.slice("--profile=".length);
  if (explicitProfile === "dev" || explicitProfile === "prod") {
    process.env.CLASH_PROFILE = explicitProfile;
  }
  process.env.CLASH_DISTRIBUTION_VERSION ??= resolveClashDistributionVersion() ?? "0.1.0";
  if (argv === process.argv) process.argv = normalizedArgv;
  await loaders[selectClashEntrypoint(normalizedArgv)]();
}
function isDirectExecution(moduleUrl, argvEntry = process.argv[1], cwd = process.cwd()) {
  if (!argvEntry) return false;
  const canonicalPath = (path) => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  return pathToFileURL(canonicalPath(resolve(cwd, argvEntry))).href === pathToFileURL(canonicalPath(fileURLToPath(moduleUrl))).href;
}
if (isDirectExecution(import.meta.url)) await runClashEntrypoint();
export {
  isDirectExecution,
  normalizeClashArgv,
  resolveClashDistributionVersion,
  runClashEntrypoint,
  selectClashEntrypoint
};
