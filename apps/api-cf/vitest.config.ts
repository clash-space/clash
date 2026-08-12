import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@clash\/shared-types\/(.+)$/,
        replacement: resolve(__dirname, "../../packages/shared-types/src/$1.ts"),
      },
      {
        find: /^@clash\/shared-types$/,
        replacement: resolve(__dirname, "../../packages/shared-types/src/index.ts"),
      },
      {
        find: /^@clash\/shared-runtime\/(.+)$/,
        replacement: resolve(__dirname, "../../packages/shared-runtime/src/$1.ts"),
      },
      {
        find: /^@clash\/shared-runtime$/,
        replacement: resolve(__dirname, "../../packages/shared-runtime/src/index.ts"),
      },
      {
        find: /^@clash\/shared-layout$/,
        replacement: resolve(__dirname, "../../packages/shared-layout/src/index.ts"),
      },
      {
        find: /^@clash\/remotion-core$/,
        replacement: resolve(__dirname, "../../packages/remotion-core/src/index.ts"),
      },
    ],
  },
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
  },
});
