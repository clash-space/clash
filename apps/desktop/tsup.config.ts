import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts", "src/preload.ts"],
  external: ["electron"],
  format: ["esm"],
  target: "node22",
});
