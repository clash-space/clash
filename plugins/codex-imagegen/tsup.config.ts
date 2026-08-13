import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/stdio.ts"],
  format: ["esm"],
  clean: true,
  target: "node24",
  // An activated plugin is copied below the Host data directory and cannot resolve workspace
  // packages from the repository. Keep every Clash SDK dependency inside this single-file payload.
  noExternal: [/^@clash\//],
  outExtension: () => ({ js: ".mjs" }),
});
