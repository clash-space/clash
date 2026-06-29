import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@clash-space/sdk": resolve(__dirname, "../../packages/clash-sdk/js/src/index.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
