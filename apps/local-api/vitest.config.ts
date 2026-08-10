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
    // Only source suites are authoritative. Without this, the compiled copies
    // under dist/ are collected too: every suite runs twice and the stale copy
    // fails against current fixtures while being unmaintainable.
    include: ["src/**/*.test.ts"],
    // Local API suites exercise process-global env, plugin seeding, SQLite,
    // filesystem watchers, and recursive temp cleanup. Keep test files serial
    // so one suite cannot starve or outlive another suite's lifecycle cleanup.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
