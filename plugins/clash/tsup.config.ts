import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2022",
  platform: "node",
  outDir: "runtime",
  clean: true,
  bundle: true,
  splitting: false,
  dts: true,
  noExternal: [
    "@clash-space/director-plugin",
    "@clash-space/director-plugin/adapter",
    "@clash-space/director-plugin/server",
    "@clash-space/mcp-server",
    "@clash-space/mcp-server/server",
    "@clash-space/timeline-plugin",
    "@clash-space/timeline-plugin/adapter",
    "@clash-space/timeline-plugin/server",
    "@clash/shared-runtime",
    "@modelcontextprotocol/ext-apps",
    "@modelcontextprotocol/sdk",
    "zod"
  ],
  banner: { js: "#!/usr/bin/env node" },
});
