import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    adapter: "src/adapter.ts",
    server: "src/server.ts",
  },
  format: ["esm"],
  target: "node24",
  platform: "node",
  outDir: "runtime",
  clean: true,
  bundle: true,
  splitting: false,
  dts: true,
  external: ["loro-crdt"],
  noExternal: [
    "@clash/shared-mcp",
    "@clash/shared-types",
    "@modelcontextprotocol/ext-apps",
    "@modelcontextprotocol/sdk",
    "zod",
  ],
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
