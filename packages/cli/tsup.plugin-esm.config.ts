import { defineConfig } from "tsup";

/**
 * ESM library entry for consumers that bundle the plugin lifecycle API.
 *
 * The CLI itself remains CommonJS because several of its transitive dependencies
 * use Node dynamic require. Feeding that already-bundled CommonJS file into a
 * second ESM bundle hides those dependency boundaries from the outer build. This
 * companion output lets ESM consumers preserve the real Node package boundaries
 * instead, while the original `dist/plugin.js` remains available to require().
 */
export default defineConfig({
  entry: { plugin: "src/lib/plugin-lifecycle.ts" },
  format: ["esm"],
  target: "node24",
  outDir: "dist",
  outExtension: () => ({ js: ".mjs" }),
  clean: false,
  bundle: true,
  splitting: false,
  dts: false,
  external: ["esbuild", "loro-crdt", "yaml"],
  noExternal: ["@clash/shared-types", "@clash/shared-layout"],
  esbuildOptions(options) {
    options.logOverride = {
      ...options.logOverride,
      "empty-import-meta": "silent",
      "direct-eval": "silent",
    };
  },
});
