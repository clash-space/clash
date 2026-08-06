import { existsSync } from "node:fs";
import { mkdir, readFile, rename } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { activateDownloadedActionPackage } from "@clash-space/cli/actions";

const FIRST_PARTY_MEDIA_ID = "clash-first-party-media";
const CODEX_IMAGEGEN_PLUGIN_ID = "clash-codex-imagegen";
const CODEX_IMAGEGEN_ACTION_ID = "codex-imagegen";

export const CODEX_IMAGEGEN_MARKETPLACE_ACTION = {
  id: CODEX_IMAGEGEN_ACTION_ID,
  name: "Codex ImageGen",
  type: "action",
  description:
    "Generate or edit images with Codex's built-in image generation tool and your ChatGPT subscription.",
  runtime: "local",
  outputType: "image",
  packageId: CODEX_IMAGEGEN_PLUGIN_ID,
  version: "0.1.0",
  author: "Clash",
  icon: "✨",
  color: "#57534e",
  tags: ["image", "codex", "local", "chatgpt"],
  promptModalities: ["text", "image"],
} as const;

function bundledPluginPaths(): { manifestPath: string; entrypointPath: string } {
  const require = createRequire(import.meta.url);
  try {
    return {
      manifestPath: require.resolve("@clash-plugin/first-party-media/manifest.json"),
      entrypointPath: require.resolve("@clash-plugin/first-party-media/stdio"),
    };
  } catch (error) {
    // Workspace development fallback. Packaged builds resolve the declared
    // dependency above; this path is never copied into the installed plugin.
    const workspacePlugin = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../plugins/first-party-media",
    );
    const manifestPath = join(workspacePlugin, "manifest.json");
    const entrypointPath = join(workspacePlugin, "dist", "stdio.mjs");
    if (existsSync(manifestPath) && existsSync(entrypointPath)) {
      return { manifestPath, entrypointPath };
    }
    throw error;
  }
}

function bundledCodexImagegenPaths(): { manifestPath: string; entrypointPath: string } {
  const require = createRequire(import.meta.url);
  try {
    return {
      manifestPath: require.resolve("@clash-plugin/codex-imagegen/manifest.json"),
      entrypointPath: require.resolve("@clash-plugin/codex-imagegen/stdio"),
    };
  } catch (error) {
    const workspacePlugin = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../plugins/codex-imagegen",
    );
    const manifestPath = join(workspacePlugin, "manifest.json");
    const entrypointPath = join(workspacePlugin, "dist", "stdio.mjs");
    if (existsSync(manifestPath) && existsSync(entrypointPath)) {
      return { manifestPath, entrypointPath };
    }
    throw error;
  }
}

export function createCodexImagegenMarketplace(options: {
  actionsRoot: string;
  manifestPath?: string;
  entrypointPath?: string;
}) {
  const targetDir = join(options.actionsRoot, CODEX_IMAGEGEN_PLUGIN_ID);
  const sourcePaths = () => {
    if (options.manifestPath && options.entrypointPath) {
      return { manifestPath: options.manifestPath, entrypointPath: options.entrypointPath };
    }
    return bundledCodexImagegenPaths();
  };

  return {
    actions: [CODEX_IMAGEGEN_MARKETPLACE_ACTION],
    async listInstalled() {
      if (!existsSync(join(targetDir, "manifest.json"))) return [];
      const manifest = JSON.parse(await readFile(join(targetDir, "manifest.json"), "utf8")) as {
        version?: string;
      };
      return [{
        actionId: CODEX_IMAGEGEN_ACTION_ID,
        name: "Codex ImageGen",
        runtime: "local",
        version: manifest.version ?? "0.0.0",
        manifest: JSON.stringify({
          ...CODEX_IMAGEGEN_MARKETPLACE_ACTION,
          id: CODEX_IMAGEGEN_ACTION_ID,
        }),
      }];
    },
    async install(packageId: string) {
      if (packageId !== CODEX_IMAGEGEN_PLUGIN_ID) {
        throw new Error(`Unknown local action package: ${packageId}`);
      }
      if (existsSync(join(targetDir, "manifest.json"))) {
        return { actionId: CODEX_IMAGEGEN_ACTION_ID, packageId, installed: false, targetDir };
      }
      const { manifestPath, entrypointPath } = sourcePaths();
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        id?: string;
        runtime?: { entrypoint?: string };
        exports?: { cards?: Array<{ path?: string }> };
        contractTests?: string[];
      };
      if (manifest.id !== CODEX_IMAGEGEN_PLUGIN_ID || !manifest.runtime?.entrypoint) {
        throw new Error("Bundled Codex ImageGen package is invalid.");
      }
      const files: Record<string, string> = {
        [manifest.runtime.entrypoint]: (await readFile(entrypointPath)).toString("base64"),
      };
      for (const card of manifest.exports?.cards ?? []) {
        if (!card.path) continue;
        files[card.path] = (await readFile(join(dirname(manifestPath), card.path))).toString("base64");
      }
      for (const contractPath of manifest.contractTests ?? []) {
        files[contractPath] = (await readFile(join(dirname(manifestPath), contractPath))).toString("base64");
      }
      const activated = await activateDownloadedActionPackage({
        id: CODEX_IMAGEGEN_PLUGIN_ID,
        manifest,
        files,
      }, options.actionsRoot);
      return {
        actionId: CODEX_IMAGEGEN_ACTION_ID,
        packageId,
        installed: true,
        targetDir: activated.targetDir,
      };
    },
    async uninstall(actionId: string) {
      if (actionId !== CODEX_IMAGEGEN_ACTION_ID) {
        throw new Error(`Unknown local action: ${actionId}`);
      }
      if (!existsSync(targetDir)) return;
      const trashRoot = join(options.actionsRoot, ".trash");
      await mkdir(trashRoot, { recursive: true });
      const firstTrash = join(trashRoot, CODEX_IMAGEGEN_PLUGIN_ID);
      const destination = existsSync(firstTrash)
        ? join(trashRoot, `${CODEX_IMAGEGEN_PLUGIN_ID}-${Date.now()}`)
        : firstTrash;
      await rename(targetDir, destination);
    },
  };
}

export async function ensureBundledFirstPartyMediaPlugin(options: {
  actionsRoot: string;
  manifestPath?: string;
  entrypointPath?: string;
}): Promise<{ installed: boolean; targetDir: string }> {
  const targetDir = join(options.actionsRoot, FIRST_PARTY_MEDIA_ID);
  // The installed directory is the user's editable source of truth. Never
  // overwrite it on app startup; upgrades go through the explicit atomic
  // activation flow so an agent's edits remain inspectable and rollbackable.
  if (existsSync(join(targetDir, "manifest.json"))) {
    return { installed: false, targetDir };
  }
  const defaults = options.manifestPath && options.entrypointPath
    ? null
    : bundledPluginPaths();
  const manifestPath = options.manifestPath ?? defaults!.manifestPath;
  const entrypointPath = options.entrypointPath ?? defaults!.entrypointPath;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    id?: string;
    runtime?: { kind?: string; entrypoint?: string };
    exports?: { cards?: Array<{ path?: string }> };
    contractTests?: string[];
  };
  if (manifest.id !== FIRST_PARTY_MEDIA_ID) {
    throw new Error(`Bundled plugin id must be ${FIRST_PARTY_MEDIA_ID}.`);
  }
  if (manifest.runtime?.kind !== "local" || !manifest.runtime.entrypoint) {
    throw new Error("Bundled first-party media plugin must have a local entrypoint.");
  }
  const entrypoint = await readFile(entrypointPath);
  const files: Record<string, string> = {
    [manifest.runtime.entrypoint]: entrypoint.toString("base64"),
  };
  const manifestDir = dirname(manifestPath);
  const declaredDocuments = [
    ...(manifest.exports?.cards ?? []).map((card) => card.path),
    ...(manifest.contractTests ?? []),
  ];
  for (const relativePath of declaredDocuments) {
    if (!relativePath) continue;
    files[relativePath] = (await readFile(join(manifestDir, relativePath))).toString("base64");
  }
  const activated = await activateDownloadedActionPackage({
    id: FIRST_PARTY_MEDIA_ID,
    manifest,
    files,
  }, options.actionsRoot);
  return { installed: true, targetDir: activated.targetDir };
}
