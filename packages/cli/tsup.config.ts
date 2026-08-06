import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    actions: "src/commands/actions.ts",
  },
  // Ship as CJS even though package.json says "type": "module" —
  // ESM bundling falls over on transitive deps that dynamic-require
  // built-in modules (e.g. yaml inside loro-crdt's chain → "Dynamic
  // require of process is not supported" at runtime). CJS lets esbuild
  // handle require/import interop inside the bundle. Shebang is
  // preserved so the npm `bin` entry stays executable.
  format: ["cjs"],
  dts: true,
  outDir: "dist",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  noExternal: ["@clash/shared-types", "@clash/shared-layout"],
});
