import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/stdio.ts"],
  format: ["esm"],
  clean: true,
  target: "node24",
  // A plugin is one file. Anything left external resolves against the host's node_modules at spawn
  // time, which is a path the plugin does not control and, once installed under ~/.clash, does not
  // have.
  noExternal: [/^@clash\//],
  outExtension: () => ({ js: ".mjs" }),
});
