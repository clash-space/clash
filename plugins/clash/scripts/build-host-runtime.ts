import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";

const pluginRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(pluginRoot, "../..");
const runtimeDir = resolve(pluginRoot, "runtime");
const importMetaUrlShim = "__clash_import_meta_url";
const require = createRequire(import.meta.url);

await mkdir(runtimeDir, { recursive: true });

await build({
  entryPoints: [resolve(pluginRoot, "src/local-api-entry.ts")],
  outfile: resolve(runtimeDir, "local-api.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
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

await cp(
  resolve(repoRoot, "packages/clash-bridge/dist/agents"),
  resolve(runtimeDir, "agents"),
  { recursive: true },
);

await cp(
  require.resolve("loro-crdt/nodejs/loro_wasm_bg.wasm"),
  resolve(runtimeDir, "loro_wasm_bg.wasm"),
);
