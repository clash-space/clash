import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/dispatcher.ts"],
  format: ["esm"],
  target: "node24",
  platform: "node",
  outDir: "runtime",
  clean: true,
  bundle: true,
  splitting: false,
  dts: true,
  // These are real runtime dependencies with Node-specific loading behavior:
  // loro's WASM and yaml use CommonJS dynamic require, while esbuild resolves
  // its platform binary at runtime. Let Node own that interop instead of
  // inlining any of them into this ESM bundle.
  external: ["esbuild", "loro-crdt", "yaml"],
  noExternal: [
    "@clash/cli/plugin",
    "@clash/director-plugin",
    "@clash/director-plugin/adapter",
    "@clash/director-plugin/server",
    "@clash/mcp-server",
    "@clash/mcp-server/server",
    "@clash/timeline-plugin",
    "@clash/timeline-plugin/adapter",
    "@clash/timeline-plugin/server",
    "@clash/shared-mcp",
    "@clash/shared-runtime",
    "@modelcontextprotocol/ext-apps",
    "@modelcontextprotocol/sdk",
    "zod",
  ],
  banner: { js: "#!/usr/bin/env node" },
});
