import { existsSync, readdirSync, statSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { build } from "esbuild";
import { BUNDLED_PLUGINS } from "../../../apps/local-api/src/bundled-plugins.js";

const pluginRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(pluginRoot, "../..");
const runtimeDir = resolve(pluginRoot, "runtime");
const importMetaUrlShim = "__clash_import_meta_url";
const require = createRequire(import.meta.url);

await mkdir(runtimeDir, { recursive: true });
// A core build must never let a stale agent tree leak into the host bundle.
// Agent metadata is installed after the host runtime is fresh.
await rm(resolve(runtimeDir, "agents"), { recursive: true, force: true });

assertDependencyDistIsFresh([
  resolve(import.meta.dirname, "../../../packages/cli"),
  resolve(import.meta.dirname, "../../../packages/shared-types"),
  resolve(import.meta.dirname, "../../../apps/local-api"),
  ...BUNDLED_PLUGINS.map((plugin) =>
    resolve(import.meta.dirname, `../../${plugin.workspaceDir}`)
  ),
]);

/**
 * Prefixed to every emitted bundle.
 *
 * A bundle sits beside the sources it inlined, so a reader who opens one -- or who searches with
 * `--no-ignore-dot` to compare what shipped against what the source says -- needs to know inside one
 * line that this is machine output. Minified `esbuild` code otherwise opens with anonymous helper
 * declarations that read exactly like authored source, and an identifier found here proves only that
 * it was inlined at some past build, not that it exists in the tree today.
 */
const GENERATED_BANNER =
  "// GENERATED FILE -- DO NOT EDIT. Written by plugins/clash/scripts/build-host-runtime.ts;\n" +
  "// edit the TypeScript sources it bundles and rebuild. Identifiers here may be stale or renamed.\n";

await build({
  entryPoints: [resolve(pluginRoot, "src/local-api-entry.ts")],
  outfile: resolve(runtimeDir, "local-api.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  // Development-only builders stay lazy and external. Packaged hosts always
  // use the browser assets copied below and never load these modules.
  external: ["@remotion/renderer", "@remotion/bundler", "esbuild"],
  define: { "import.meta.url": importMetaUrlShim },
  banner: {
    js: `${GENERATED_BANNER}const ${importMetaUrlShim} = require("node:url").pathToFileURL(__filename).href;`,
  },
});

/**
 * Official Providers are part of the Clash distribution, not packages a user installs later.
 *
 * esbuild cannot inline a manifest, provider declaration, contract fixture, and subprocess
 * entrypoint reached through dynamic `require.resolve()`. Copy those exact declared files beside
 * local-api.cjs; the host seeds its private runtime directory from this immutable payload.
 */
const bundledPluginRuntimeRoot = resolve(runtimeDir, "bundled-plugins");
await rm(bundledPluginRuntimeRoot, { recursive: true, force: true });
for (const plugin of BUNDLED_PLUGINS) {
  const sourceRoot = resolve(repoRoot, "plugins", plugin.workspaceDir);
  const targetRoot = resolve(bundledPluginRuntimeRoot, plugin.workspaceDir);
  const manifest = JSON.parse(await readFile(resolve(sourceRoot, "manifest.json"), "utf8")) as {
    runtime?: { entrypoint?: string };
    contributes?: {
      cards?: Array<{ path?: string }>;
      providers?: Array<{ path?: string }>;
      modelBindings?: Array<{ path?: string }>;
    };
    contractTests?: string[];
  };
  const declaredFiles = new Set([
    "manifest.json",
    manifest.runtime?.entrypoint,
    ...(manifest.contributes?.cards ?? []).map((entry) => entry.path),
    ...(manifest.contributes?.providers ?? []).map((entry) => entry.path),
    ...(manifest.contributes?.modelBindings ?? []).map((entry) => entry.path),
    ...(manifest.contractTests ?? []),
  ].filter((path): path is string => Boolean(path)));
  for (const relativePath of declaredFiles) {
    const target = resolve(targetRoot, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await cp(resolve(sourceRoot, relativePath), target);
  }
}

await build({
  entryPoints: [resolve(repoRoot, "packages/cli/src/plugin.ts")],
  outfile: resolve(runtimeDir, "clash-cli.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  define: { "import.meta.url": importMetaUrlShim },
  banner: {
    js: `#!/usr/bin/env node\n${GENERATED_BANNER}const ${importMetaUrlShim} = require("node:url").pathToFileURL(__filename).href;`,
  },
});

// Keep tracked package artefacts diff-clean even when an inlined dependency
// emits whitespace-only lines. This is a deterministic formatting pass over
// generated output, not an authored-source rewrite.
for (const filename of ["local-api.cjs", "clash-cli.cjs"]) {
  const path = resolve(runtimeDir, filename);
  const source = await readFile(path, "utf8");
  const normalized = source.replace(/[ \t]+$/gm, "");
  if (normalized !== source) await writeFile(path, normalized, "utf8");
}

const directorBundleDir = resolve(runtimeDir, "director-bundle");
await rm(directorBundleDir, { recursive: true, force: true });
await mkdir(directorBundleDir, { recursive: true });
await build({
  entryPoints: [
    resolve(repoRoot, "packages/director-ui/src/headless-entry.tsx"),
  ],
  outfile: resolve(directorBundleDir, "index.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "chrome120",
  minify: true,
});
await writeFile(
  resolve(directorBundleDir, "index.html"),
  [
    "<!doctype html>",
    '<html><head><meta charset="utf-8"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#171816}</style></head>',
    '<body><div id="root"></div><script type="module" src="./index.js"></script></body></html>',
    "",
  ].join("\n"),
  "utf8",
);
await rm(resolve(runtimeDir, "assets"), { recursive: true, force: true });
await cp(
  resolve(repoRoot, "packages/director-ui/assets"),
  resolve(runtimeDir, "assets"),
  { recursive: true },
);

await cp(
  require.resolve("loro-crdt/nodejs/loro_wasm_bg.wasm"),
  resolve(runtimeDir, "loro_wasm_bg.wasm"),
);

const remotionBundleDir = resolve(runtimeDir, "remotion-bundle");
await rm(remotionBundleDir, { recursive: true, force: true });
await cp(resolve(repoRoot, "apps/render-server/.remotion-bundle"), remotionBundleDir, {
  recursive: true,
  filter: (source) => !source.endsWith(".map"),
});

const removeSourceMapReferences = async (directory: string): Promise<void> => {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await removeSourceMapReferences(path);
        return;
      }
      if (!entry.name.endsWith(".js")) return;
      const source = await readFile(path, "utf8");
      const portableSource = source.replace(
        /^\s*\/\/[#@]\s*sourceMappingURL=.*\.map\s*$/gm,
        "",
      );
      if (portableSource !== source)
        await writeFile(path, portableSource, "utf8");
    }),
  );
};

await removeSourceMapReferences(remotionBundleDir);

const remotionIndexPath = resolve(remotionBundleDir, "index.html");
const remotionIndex = await readFile(remotionIndexPath, "utf8");
const remotionCwdPattern = /window\.remotion_cwd = [^;]+;/;
if (!remotionCwdPattern.test(remotionIndex)) {
  throw new Error("Remotion bundle index is missing window.remotion_cwd");
}
const portableRemotionIndex = remotionIndex.replace(
  remotionCwdPattern,
  'window.remotion_cwd = ".";',
);
await writeFile(remotionIndexPath, portableRemotionIndex, "utf8");

/**
 * Fails the build when a workspace dependency's `dist` is older than its `src`.
 *
 * This script bundles compiled output, so a dependency that was edited but not rebuilt is silently
 * baked in at its previous version. The symptom is that a fix "does not work": the host restarts,
 * reports the new version, and runs the old code. That happened three times in one session -- a
 * hardcoded duration and a 4 MB frame limit both survived their own fixes, and the second surfaced
 * as an unrelated "mismatched response".
 */
function assertDependencyDistIsFresh(packageDirs: readonly string[]): void {
  const stale: string[] = [];
  for (const dir of packageDirs) {
    const srcDir = join(dir, "src");
    const distDir = join(dir, "dist");
    if (!existsSync(srcDir) || !existsSync(distDir)) continue;
    const newestSource = newestMtime(srcDir);
    const newestBuild = newestMtime(distDir);
    if (
      newestSource !== undefined &&
      newestBuild !== undefined &&
      newestSource > newestBuild
    ) {
      stale.push(relative(process.cwd(), dir));
    }
  }
  if (stale.length > 0) {
    throw new Error(
      `Refusing to bundle the host: dist is older than src in ${stale.join(", ")}. ` +
        "Run `pnpm build:package clash` from the repository root so Turbo rebuilds the dependency graph.",
    );
  }
}

function newestMtime(dir: string): number | undefined {
  let newest: number | undefined;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    const stamp = entry.isDirectory()
      ? newestMtime(full)
      : statSync(full).mtimeMs;
    if (stamp !== undefined && (newest === undefined || stamp > newest))
      newest = stamp;
  }
  return newest;
}
