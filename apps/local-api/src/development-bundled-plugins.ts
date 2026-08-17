import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  ExecutablePluginManifestSchema,
  isSafePluginRelativePath,
} from "@clash/shared-types";

import {
  BUNDLED_PLUGINS,
  bundledPluginPayloadFiles,
} from "./bundled-plugins.js";

const execFileAsync = promisify(execFile);

export interface DevelopmentBundledPluginBuild {
  id: string;
  packageName: string;
  pluginRoot: string;
  manifestPath: string;
  entrypointPath: string;
}

export type DevelopmentBundledPluginBuilder = (
  plugin: DevelopmentBundledPluginBuild,
) => Promise<void>;

export interface DevelopmentBundledPlugins {
  /** First-party immutable payloads rebuilt before this development Host starts. */
  rebuilt: readonly string[];
}

function workspaceRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

async function buildPluginPackage(
  plugin: DevelopmentBundledPluginBuild,
): Promise<void> {
  const packageManager = process.env.npm_execpath;
  const scriptEntrypoint = packageManager?.match(/\.[cm]?js$/i);
  const nodeExecutable =
    process.env.CLASH_NODE_EXEC_PATH?.trim() || process.execPath;
  const executable = scriptEntrypoint
    ? nodeExecutable
    : (packageManager ?? "pnpm");
  const args = scriptEntrypoint
    ? [packageManager!, "run", "build"]
    : ["run", "build"];
  const childEnv = {
    ...process.env,
    PATH: [dirname(nodeExecutable), process.env.PATH]
      .filter((part): part is string => Boolean(part))
      .join(delimiter),
  };
  try {
    await execFileAsync(executable, args, {
      cwd: plugin.pluginRoot,
      env: childEnv,
    });
  } catch (error) {
    const details = error as Error & { stderr?: string; stdout?: string };
    throw new Error(
      `Could not rebuild development plugin ${plugin.id}: ` +
        (details.stderr?.trim() ||
          details.stdout?.trim() ||
          details.message ||
          String(error)),
      { cause: error },
    );
  }
}

/**
 * Rebuild the workspace payloads consumed by the closed first-party module registry.
 *
 * Development changes how immutable package bytes are produced, not where trust comes from. This
 * helper deliberately never copies a launcher, manifest, activation receipt, or source file into
 * the user's actions directory. That directory remains exclusively the activation authority for
 * third-party process/stdio plugins.
 */
export async function prepareDevelopmentBundledPlugins(options: {
  /** Kept at the call boundary so tests can prove it is never mutated or trusted. */
  actionsRoot: string;
  /** Legacy caller input; source modules now compile through each plugin package's build script. */
  tsconfigPath?: string;
  root?: string;
  pluginIds?: readonly string[];
  /** Test seam; production runs each selected package's checked-in build script. */
  buildPlugin?: DevelopmentBundledPluginBuilder;
}): Promise<DevelopmentBundledPlugins> {
  const root = options.root ?? workspaceRoot();
  const selected =
    options.pluginIds === undefined
      ? BUNDLED_PLUGINS
      : BUNDLED_PLUGINS.filter((plugin) =>
          options.pluginIds!.includes(plugin.id),
        );
  const requested = new Set(options.pluginIds ?? []);
  for (const plugin of selected) requested.delete(plugin.id);
  if (requested.size > 0) {
    throw new Error(
      `Unknown bundled development plugin${requested.size === 1 ? "" : "s"}: ${[
        ...requested,
      ].join(", ")}`,
    );
  }

  const buildPlugin = options.buildPlugin ?? buildPluginPackage;
  const rebuilt: string[] = [];
  for (const plugin of selected) {
    const pluginRoot = join(root, "plugins", plugin.workspaceDir);
    const manifestPath = join(pluginRoot, "manifest.json");
    const manifest = ExecutablePluginManifestSchema.parse(
      JSON.parse(await readFile(manifestPath, "utf8")),
    );
    if (manifest.id !== plugin.id) {
      throw new Error(
        `Expected development plugin ${plugin.id}, but ${manifestPath} declares ${manifest.id}.`,
      );
    }
    if (
      manifest.runtime.kind !== "local" ||
      manifest.runtime.transport !== "stdio" ||
      !isSafePluginRelativePath(manifest.runtime.entrypoint)
    ) {
      throw new Error(
        `Development plugin ${plugin.id} must declare a safe local stdio entrypoint.`,
      );
    }
    const entrypointPath = join(pluginRoot, manifest.runtime.entrypoint);
    await buildPlugin({
      id: plugin.id,
      packageName: plugin.packageName,
      pluginRoot,
      manifestPath,
      entrypointPath,
    });
    if (!existsSync(entrypointPath)) {
      throw new Error(
        `Development plugin ${plugin.id} build did not produce ${manifest.runtime.entrypoint}.`,
      );
    }
    for (const resource of manifest.runtime.resources ?? []) {
      if (!existsSync(join(pluginRoot, resource))) {
        throw new Error(
          `Development plugin ${plugin.id} build did not produce declared resource ${resource}.`,
        );
      }
    }
    try {
      await bundledPluginPayloadFiles(manifest, pluginRoot);
    } catch (error) {
      throw new Error(
        `Development plugin ${plugin.id} build produced an invalid declared payload: ${(error as Error).message}`,
        { cause: error },
      );
    }
    rebuilt.push(plugin.id);
  }

  return { rebuilt };
}
