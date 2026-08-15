import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@clash\/asset-sdk$/,
        replacement: resolve(__dirname, "../asset-sdk/src/index.ts"),
      },
      {
        find: /^@clash\/shared-runtime\/project-host-client$/,
        replacement: resolve(
          __dirname,
          "../shared-runtime/src/project-host-client.ts",
        ),
      },
      {
        find: /^@clash\/shared-runtime$/,
        replacement: resolve(__dirname, "../shared-runtime/src/index.ts"),
      },
      {
        find: /^@clash\/shared-types\/(.+)$/,
        replacement: resolve(__dirname, "../shared-types/src/$1.ts"),
      },
      {
        find: /^@clash\/shared-types$/,
        replacement: resolve(__dirname, "../shared-types/src/index.ts"),
      },
    ],
  },
  test: {
    // Source is authoritative; a previous local build must not make every suite run twice.
    include: ["src/**/*.test.ts"],
  },
});
