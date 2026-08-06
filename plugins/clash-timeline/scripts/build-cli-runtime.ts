import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";

const pluginRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(pluginRoot, "../..");
const runtimeDirectory = resolve(pluginRoot, "runtime");
const importMetaUrlShim = "__clash_import_meta_url";
const require = createRequire(import.meta.url);

await mkdir(runtimeDirectory, { recursive: true });
await build({
  entryPoints: [resolve(repositoryRoot, "packages/cli/src/plugin.ts")],
  outfile: resolve(runtimeDirectory, "clash-cli.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  define: { "import.meta.url": importMetaUrlShim },
  banner: {
    js: `#!/usr/bin/env node\nconst ${importMetaUrlShim} = require("node:url").pathToFileURL(__filename).href;`,
  },
});

await cp(
  require.resolve("loro-crdt/nodejs/loro_wasm_bg.wasm"),
  resolve(runtimeDirectory, "loro_wasm_bg.wasm"),
);
