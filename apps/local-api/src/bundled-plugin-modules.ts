import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import type { PluginModule } from "@clash/action-sdk";
import { ExecutablePluginManifestSchema } from "@clash/shared-types";

import { BUNDLED_PLUGINS, bundledPluginPaths } from "./bundled-plugins.js";

export interface TrustedBundledPluginModuleRegistration {
  readonly id: string;
}

export interface LoadedTrustedBundledPluginModule {
  id: string;
  manifestPath: string;
  entrypointPath: string;
  plugin: PluginModule;
}

/**
 * The in-process trust root. A package manifest cannot opt itself into this list.
 *
 * These records deliberately contain no runtime realm in their semantic payload. The Host chooses
 * module execution because the package is in this closed source registry; Project Generator facts
 * continue to pin only the plugin/version/export/schema contract.
 */
export const TRUSTED_BUNDLED_PLUGIN_MODULES = Object.freeze(
  BUNDLED_PLUGINS.map(({ id }) => Object.freeze({ id })),
) satisfies readonly TrustedBundledPluginModuleRegistration[];

function isPluginModule(value: unknown): value is PluginModule {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PluginModule>;
  return (
    typeof candidate.invoke === "function" &&
    Array.isArray(candidate.contributes)
  );
}

export async function loadTrustedBundledPluginModule(
  pluginId: string,
): Promise<LoadedTrustedBundledPluginModule> {
  const registration = TRUSTED_BUNDLED_PLUGIN_MODULES.find(
    ({ id }) => id === pluginId,
  );
  if (!registration) {
    throw new Error(`${pluginId} is not a trusted bundled plugin.`);
  }

  const { manifestPath, entrypointPath } = bundledPluginPaths(pluginId);
  const rawManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const manifest = ExecutablePluginManifestSchema.parse(rawManifest);
  if (manifest.id !== registration.id) {
    throw new Error(
      `Trusted bundled registration ${registration.id} resolves manifest ${manifest.id}.`,
    );
  }

  const imported = (await import(pathToFileURL(entrypointPath).href)) as {
    plugin?: unknown;
  };
  if (!isPluginModule(imported.plugin)) {
    throw new Error(
      `Trusted bundled plugin ${pluginId} does not export a PluginModule named plugin.`,
    );
  }
  const moduleFunctions = ExecutablePluginManifestSchema.parse({
    ...rawManifest,
    contributes: {
      ...(rawManifest as { contributes?: Record<string, unknown> }).contributes,
      functions: imported.plugin.contributes,
    },
  }).contributes.functions;
  if (
    JSON.stringify(moduleFunctions) !==
    JSON.stringify(manifest.contributes.functions)
  ) {
    throw new Error(
      `Trusted bundled plugin ${pluginId} executable exports differ from its manifest.`,
    );
  }

  return {
    id: registration.id,
    manifestPath,
    entrypointPath,
    plugin: imported.plugin,
  };
}
