import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: /^@clash\/action-sdk\/browser$/,
        replacement: resolve(__dirname, "../action-sdk/src/browser.ts"),
      },
      {
        find: /^react$/,
        replacement: resolve(__dirname, "node_modules/react/index.js"),
      },
      {
        find: /^react\/jsx-runtime$/,
        replacement: resolve(__dirname, "node_modules/react/jsx-runtime.js"),
      },
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: resolve(
          __dirname,
          "node_modules/react/jsx-dev-runtime.js",
        ),
      },
      {
        find: /^react-dom$/,
        replacement: resolve(__dirname, "node_modules/react-dom/index.js"),
      },
      {
        find: /^@radix-ui\/react-collapsible$/,
        replacement: resolve(
          __dirname,
          "node_modules/@radix-ui/react-collapsible/dist/index.mjs",
        ),
      },
      {
        find: /^streamdown$/,
        replacement: resolve(
          __dirname,
          "node_modules/streamdown/dist/index.js",
        ),
      },
      {
        find: /^lucide-react$/,
        replacement: resolve(
          __dirname,
          "node_modules/lucide-react/dist/esm/lucide-react.mjs",
        ),
      },
      {
        find: /^@clash\/asset-sdk$/,
        replacement: resolve(__dirname, "../asset-sdk/src/index.ts"),
      },
      {
        find: /^@clash\/gui\/test-support\/source-match$/,
        replacement: resolve(__dirname, "../gui/test-support/source-match.ts"),
      },
      {
        find: /^@clash\/gui\/(.+)$/,
        replacement: resolve(__dirname, "../gui/src/$1"),
      },
      {
        find: /^@clash\/gui$/,
        replacement: resolve(__dirname, "../gui/src/index.ts"),
      },
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
      {
        find: /^@clash\/shared-runtime\/(.+)$/,
        replacement: resolve(__dirname, "../shared-runtime/src/$1.ts"),
      },
      {
        find: /^@clash\/shared-runtime$/,
        replacement: resolve(__dirname, "../shared-runtime/src/browser.ts"),
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
