import { existsSync, readdirSync, statSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { build } from "esbuild";

const pluginRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(pluginRoot, "../..");
const runtimeDir = resolve(pluginRoot, "runtime");
const importMetaUrlShim = "__clash_import_meta_url";
const require = createRequire(import.meta.url);

await mkdir(runtimeDir, { recursive: true });
// A core build must never let a stale agent tree leak into the bridge bundle.
// The fresh agent tree is installed only after the bridge has rebuilt it.
await rm(resolve(runtimeDir, "agents"), { recursive: true, force: true });

assertDependencyDistIsFresh([
  resolve(import.meta.dirname, "../../../packages/clash-bridge"),
  resolve(import.meta.dirname, "../../../packages/shared-types"),
  resolve(import.meta.dirname, "../../../apps/local-api"),
]);

await build({
  entryPoints: [resolve(pluginRoot, "src/local-api-entry.ts")],
  outfile: resolve(runtimeDir, "local-api.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["@remotion/renderer"],
  define: { "import.meta.url": importMetaUrlShim },
  banner: {
    js: `const ${importMetaUrlShim} = require("node:url").pathToFileURL(__filename).href;`,
  },
});

await build({
  entryPoints: [resolve(repoRoot, "packages/cli/src/plugin.ts")],
  outfile: resolve(runtimeDir, "clash-cli.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  define: { "import.meta.url": importMetaUrlShim },
  banner: {
    js: `#!/usr/bin/env node\nconst ${importMetaUrlShim} = require("node:url").pathToFileURL(__filename).href;`,
  },
});

const directorBundleDir = resolve(runtimeDir, "director-bundle");
await rm(directorBundleDir, { recursive: true, force: true });
await mkdir(directorBundleDir, { recursive: true });
await build({
  entryPoints: [resolve(repoRoot, "packages/director-ui/src/headless-entry.tsx")],
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
await cp(
  resolve(repoRoot, ".remotion-bundle"),
  remotionBundleDir,
  {
    recursive: true,
    filter: (source) => !source.endsWith(".map"),
  },
);

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
      if (portableSource !== source) await writeFile(path, portableSource, "utf8");
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
    if (newestSource !== undefined && newestBuild !== undefined && newestSource > newestBuild) {
      stale.push(relative(process.cwd(), dir));
    }
  }
  if (stale.length > 0) {
    throw new Error(
      `Refusing to bundle the host: dist is older than src in ${stale.join(", ")}. `
      + `Run the dependency build first (pnpm build:deps), or the host will run the previous code.`,
    );
  }
}

function newestMtime(dir: string): number | undefined {
  let newest: number | undefined;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    const stamp = entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs;
    if (stamp !== undefined && (newest === undefined || stamp > newest)) newest = stamp;
  }
  return newest;
}
