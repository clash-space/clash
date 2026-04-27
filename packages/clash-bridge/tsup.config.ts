import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  // acp-runtime is vendored into ./src/_acp-runtime — no external bundle
  // step needed. ws and @agentclientprotocol/sdk stay external (declared
  // in package.json) so npm dedupes correctly with parent installs.
});
