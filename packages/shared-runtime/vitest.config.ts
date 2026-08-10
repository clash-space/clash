import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Only source suites are authoritative. Without this, the compiled copies
    // under dist/ are collected too, so every suite runs twice and a stale
    // build can pass or fail independently of the code under review.
    include: ["src/**/*.test.ts"],
  },
});
