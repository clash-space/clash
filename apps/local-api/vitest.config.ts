import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@clash-space/sdk": resolve(__dirname, "../../packages/clash-sdk/js/src/index.ts"),
      "@clash/shared-types": resolve(__dirname, "../../packages/shared-types/src/index.ts"),
      "@clash/shared-types/assets": resolve(__dirname, "../../packages/shared-types/src/assets.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
