import { isDeepStrictEqual } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BUNDLED_PLUGINS } from "./bundled-plugins.js";
import {
  activateHostExecutablePluginPackage,
  readHostExecutablePluginPackage,
  validateHostExecutablePluginPackage,
  type HostExecutablePluginPackage,
} from "./runtime/plugin-package.js";

interface DevelopmentManifest {
  id?: string;
  runtime?: { kind?: string; transport?: string; entrypoint?: string };
  contributes?: {
    cards?: Array<{ path?: string }>;
    providers?: Array<{ path?: string }>;
    modelBindings?: Array<{ path?: string }>;
  };
  contractTests?: string[];
}

export interface DevelopmentBundledPlugins {
  /** Plugin and workspace dependency roots; ActionsHost uses these only as restart signals. */
  watchRoots: Readonly<Record<string, readonly string[]>>;
  /** Plugins whose attested development launcher changed during this preparation. */
  refreshed: readonly string[];
}

function workspaceRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

function developmentLauncher(options: {
  sourceEntrypoint: string;
  tsconfigPath: string;
  tsxApiUrl: string;
}): string {
  const sourceUrl = pathToFileURL(options.sourceEntrypoint).href;
  return [
    `import { register } from ${JSON.stringify(options.tsxApiUrl)};`,
    `register({ tsconfig: ${JSON.stringify(options.tsconfigPath)} });`,
    // The checked-in stdio entries start only when they are the program entrypoint. The launcher
    // remains the actual Node entry, so give the source module the argv identity it would have
    // under `node --import tsx src/stdio.ts` before importing it.
    `process.argv[1] = ${JSON.stringify(options.sourceEntrypoint)};`,
    `await import(${JSON.stringify(sourceUrl)});`,
    "",
  ].join("\n");
}

async function developmentPackage(options: {
  pluginRoot: string;
  expectedId: string;
  tsconfigPath: string;
  tsxApiUrl: string;
}): Promise<HostExecutablePluginPackage> {
  const manifestPath = join(options.pluginRoot, "manifest.json");
  const sourceEntrypoint = join(options.pluginRoot, "src", "stdio.ts");
  if (!existsSync(sourceEntrypoint)) {
    throw new Error(
      `Development plugin ${options.expectedId} has no src/stdio.ts entrypoint.`,
    );
  }
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as DevelopmentManifest;
  if (manifest.id !== options.expectedId) {
    throw new Error(
      `Expected development plugin ${options.expectedId}, but ${manifestPath} declares ${manifest.id}.`,
    );
  }
  if (
    manifest.runtime?.kind !== "local" ||
    manifest.runtime.transport !== "stdio" ||
    !manifest.runtime.entrypoint
  ) {
    throw new Error(
      `Development plugin ${options.expectedId} must declare a local stdio entrypoint.`,
    );
  }

  const files: Record<string, string> = {
    [manifest.runtime.entrypoint]: Buffer.from(
      developmentLauncher({
        sourceEntrypoint,
        tsconfigPath: options.tsconfigPath,
        tsxApiUrl: options.tsxApiUrl,
      }),
    ).toString("base64"),
  };
  const documents = [
    ...(manifest.contributes?.cards ?? []).map((entry) => entry.path),
    ...(manifest.contributes?.providers ?? []).map((entry) => entry.path),
    ...(manifest.contributes?.modelBindings ?? []).map((entry) => entry.path),
    ...(manifest.contractTests ?? []),
  ];
  for (const relativePath of documents) {
    if (!relativePath) continue;
    files[relativePath] = (
      await readFile(join(options.pluginRoot, relativePath))
    ).toString("base64");
  }
  return { id: options.expectedId, manifest, files };
}

async function activePackageMatches(
  actionsRoot: string,
  input: HostExecutablePluginPackage,
): Promise<boolean> {
  try {
    const active = await readHostExecutablePluginPackage(actionsRoot, input.id);
    const manifest = validateHostExecutablePluginPackage(input);
    return (
      isDeepStrictEqual(active.manifest, manifest) &&
      isDeepStrictEqual(active.files, input.files)
    );
  } catch {
    return false;
  }
}

/**
 * Install source-backed launchers for the bundled plugins into the isolated development
 * profile. Each launcher is still validated, contract-tested, copied into daemon-owned storage and
 * attested by the normal activation path. The only development exception is what its JS imports:
 * workspace TypeScript through tsx instead of a previously built `dist/stdio.mjs`.
 *
 * A displaced package is retained outside the live actions directory. This keeps preparation
 * recoverable and avoids silently destroying a developer's previous dev-profile install.
 */
export async function prepareDevelopmentBundledPlugins(options: {
  actionsRoot: string;
  tsconfigPath: string;
  root?: string;
  /** Internal source-launcher selection used by isolated provider tests. */
  pluginIds?: readonly string[];
}): Promise<DevelopmentBundledPlugins> {
  const root = options.root ?? workspaceRoot();
  const tsxApiUrl = pathToFileURL(
    createRequire(import.meta.url).resolve("tsx/esm/api"),
  ).href;
  const watchRoots: Record<string, readonly string[]> = {};
  const refreshed: string[] = [];
  const actionSdkSource = join(root, "packages", "action-sdk", "src");
  const sharedRuntimeSource = join(
    root,
    "packages",
    "shared-runtime",
    "src",
  );
  const sharedTypesSource = join(root, "packages", "shared-types", "src");
  await mkdir(options.actionsRoot, { recursive: true });

  const plugins =
    options.pluginIds === undefined
      ? BUNDLED_PLUGINS
      : BUNDLED_PLUGINS.filter((plugin) =>
          options.pluginIds!.includes(plugin.id),
        );
  for (const plugin of plugins) {
    const pluginRoot = join(root, "plugins", plugin.workspaceDir);
    const input = await developmentPackage({
      pluginRoot,
      expectedId: plugin.id,
      tsconfigPath: options.tsconfigPath,
      tsxApiUrl,
    });
    watchRoots[plugin.id] = [
      join(pluginRoot, "src"),
      // Every bundled executable imports the shared Action SDK. Its source is loaded directly by
      // the development launcher, so an SDK edit must recycle every affected long-lived child.
      actionSdkSource,
      ...(plugin.id === "clash.minimax" || plugin.id === "clash.pika"
        ? [sharedRuntimeSource]
        : []),
      sharedTypesSource,
    ];
    if (await activePackageMatches(options.actionsRoot, input)) continue;

    const targetDir = join(options.actionsRoot, plugin.id);
    let backupDir: string | undefined;
    if (existsSync(targetDir)) {
      const backupRoot = join(
        `${options.actionsRoot}.development-backups`,
        plugin.id,
      );
      await mkdir(backupRoot, { recursive: true });
      backupDir = join(backupRoot, `${Date.now()}-${randomUUID()}`);
      await rename(targetDir, backupDir);
    }
    try {
      await activateHostExecutablePluginPackage(input, options.actionsRoot);
      refreshed.push(plugin.id);
    } catch (error) {
      // Activation removes a partially written target. Keep the explicit cleanup scoped to the
      // exact first-party id, then restore the previously attested directory if there was one.
      if (existsSync(targetDir))
        await rm(targetDir, { recursive: true, force: true });
      if (backupDir && existsSync(backupDir))
        await rename(backupDir, targetDir);
      throw error;
    }
  }

  return { watchRoots, refreshed };
}
