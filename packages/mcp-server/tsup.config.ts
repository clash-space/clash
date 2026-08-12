import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    server: "src/server.ts",
  },
  format: ["esm"],
  target: "node24",
  outDir: "dist",
  clean: true,
  dts: true,
});
