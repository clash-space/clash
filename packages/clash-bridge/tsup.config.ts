import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  // Bundle acp-runtime in — it's a workspace-style file: dep that we want
  // to ship inside the bridge binary so users only install one package.
  noExternal: ["@open-managed-agents/acp-runtime"],
});
