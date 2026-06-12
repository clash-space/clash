import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    "codex-app-server-acp": "src/codex-app-server-acp.ts",
    "acp-runtime": "src/_acp-runtime/index.ts",
    "cc-sessions": "src/lib/cc-sessions.ts",
    platform: "src/lib/platform.ts",
    "session-manager": "src/lib/session-manager.ts",
  },
  format: ["esm"],
  outDir: "dist",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  // acp-runtime is vendored into ./src/_acp-runtime — no external bundle
  // step needed. ws and @agentclientprotocol/sdk stay external (declared
  // in package.json) so npm dedupes correctly with parent installs.
});
