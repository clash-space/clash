import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ExecutablePluginInvocation } from "@clash/shared-types/executable-plugin";

import {
  assemblePluginModule as assembleBrowserPluginModule,
  type BrowserPluginModuleOptions,
  type ManifestFunction,
  type PluginModule,
} from "./browser.js";
import {
  defineStdioExecutablePlugin,
  type StdioExecutablePlugin,
  type StdioExecutablePluginOptions,
} from "./stdio-plugin.js";
import type { ExecutorContext } from "./define-plugin.js";

export {
  defineAction,
  defineActionExecutor,
  defineExecutor,
  defineProjector,
  type Action,
  type ManifestFunction,
  type PluginExecutionRealm,
  type PluginModule,
  type ProjectorFn,
} from "./browser.js";

export interface AssembleOptions {
  manifestDir: string;
  contributes: Record<string, unknown>;
}

export interface AssembledPlugin extends PluginModule {
  start(options?: StdioExecutablePluginOptions): Promise<void>;
}

function readModuleOptions(
  options: AssembleOptions,
): BrowserPluginModuleOptions {
  const manifest = JSON.parse(
    readFileSync(join(options.manifestDir, "manifest.json"), "utf8"),
  ) as { id?: string; contributes?: { functions?: ManifestFunction[] } };
  return {
    functions: manifest.contributes?.functions ?? [],
    contributes: options.contributes,
    ...(manifest.id ? { pluginId: manifest.id } : {}),
  };
}

/** Assemble the exact module used by local, cloud, and client runners. */
export function assemblePluginModule(options: AssembleOptions): PluginModule {
  return assembleBrowserPluginModule(readModuleOptions(options));
}

/** Serve one already-assembled module through the legacy stdio adapter. */
export function servePluginStdio(
  module: PluginModule,
  options?: StdioExecutablePluginOptions,
): StdioExecutablePlugin {
  return defineStdioExecutablePlugin(
    Object.fromEntries(
      module.contributes.map(({ id }) => [
        id,
        (
          invocation: ExecutablePluginInvocation,
          hostContext: ExecutorContext,
        ) => module.invoke(invocation, hostContext),
      ]),
    ),
    options,
  );
}

export function assemblePlugin(options: AssembleOptions): AssembledPlugin {
  const module = assemblePluginModule(options);
  return {
    ...module,
    start: (stdioOptions) => servePluginStdio(module, stdioOptions).done,
  };
}
