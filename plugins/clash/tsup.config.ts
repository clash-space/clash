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
  // `yaml` publishes a Node-targeted CommonJS implementation. Keep it as a
  // real runtime dependency so Node performs the CJS/ESM interop; inlining it
  // into this ESM bundle turns its `require("process")` calls into unsupported
  // dynamic requires.
  external: ["loro-crdt", "yaml"],
  noExternal: [
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
