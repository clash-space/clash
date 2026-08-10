import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      // A string alias is a prefix match, so `@clash/shared-types` alone rewrote
      // `@clash/shared-types/timeline-library` into `.../src/index.ts/timeline-library`.
      // Subpath entries must be matched first, and each maps to its own source file so
      // suites still read source rather than a possibly stale build.
      {
        find: /^@clash\/shared-types\/(.+)$/,
        replacement: resolve(__dirname, "../shared-types/src/$1.ts"),
      },
      {
        find: /^@clash\/shared-types$/,
        replacement: resolve(__dirname, "../shared-types/src/index.ts"),
      },
      {
        find: /^@clash\/shared-layout$/,
        replacement: resolve(__dirname, "../shared-layout/src/index.ts"),
      },
    ],
  },
  test: {
    // Source-scanning suites are the majority here and they read repository
    // files through `import.meta.url`, which jsdom rewrites away from file://.
    // Component suites opt into a DOM with `// @vitest-environment jsdom`.
    environment: "node",
    // Only source suites are authoritative, so a stale build can never decide
    // whether the suite passes.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 20_000,
  },
});
