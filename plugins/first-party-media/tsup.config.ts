import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/stdio.ts"],
  format: ["esm"],
  clean: true,
  target: "node20",
  noExternal: ["@clash/shared-types/executable-plugin"],
  outExtension: () => ({ js: ".mjs" }),
});
