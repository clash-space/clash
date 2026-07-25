import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    adapter: "src/adapter.ts",
    server: "src/server.ts",
  },
  format: ["esm"],
  target: "es2022",
  platform: "node",
  outDir: "runtime",
  clean: true,
  bundle: true,
  splitting: false,
  dts: true,
  noExternal: [
    "@modelcontextprotocol/ext-apps",
    "@modelcontextprotocol/sdk",
    "zod",
  ],
  banner: { js: "#!/usr/bin/env node" },
});
