import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    plugin: "src/lib/plugin-lifecycle.ts",
  },
  // Ship as CJS even though package.json says "type": "module" —
  // ESM bundling falls over on bundled transitive dependencies that
  // dynamic-require built-in modules ("Dynamic require of process is not
  // supported" at runtime). CJS lets esbuild
  // handle require/import interop inside the bundle. Shebang is
  // preserved so the npm `bin` entry stays executable.
  format: ["cjs"],
  target: "node24",
  dts: true,
  outDir: "dist",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  noExternal: ["@clash/shared-types", "@clash/shared-layout"],
  esbuildOptions(options) {
    options.logOverride = {
      ...options.logOverride,
      // node-require.ts deliberately supports both tsx/ESM source execution and the shipped CJS
      // bundle. These two warnings describe that intentional compatibility branch.
      "empty-import-meta": "silent",
      "direct-eval": "silent",
    };
  },
});
