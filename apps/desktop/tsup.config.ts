import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts", "src/preload.ts"],
  external: ["electron", "@remotion/bundler", "@remotion/renderer"],
  format: ["esm"],
  target: "node24",
});
