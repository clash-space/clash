import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    "acp-runtime": "src/_acp-runtime/index.ts",
    "cc-sessions": "src/lib/cc-sessions.ts",
    platform: "src/lib/platform.ts",
    "session-manager": "src/lib/session-manager.ts",
  },
  format: ["esm"],
  outDir: "dist",
  // Runtime-only builds happen after the bundled agent tree is assembled.
  // The package script removes stale runtime outputs while preserving
  // dist/agents; tsup must not delete that independently built subtree.
  clean: false,
  banner: { js: "#!/usr/bin/env node" },
  // acp-runtime is vendored into ./src/_acp-runtime — no external bundle
  // step needed. ws and @agentclientprotocol/sdk stay external (declared
  // in package.json) so npm dedupes correctly with parent installs.
});
