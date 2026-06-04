import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@clash/shared-runtime": new URL("../../packages/shared-runtime/src/index.ts", import.meta.url)
        .pathname,
    },
  },
  test: {
    environment: "node",
  },
});
