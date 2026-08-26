import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts", "src/preload.ts"],
  external: ["electron", "@remotion/bundler", "@remotion/renderer", "loro-crdt"],
  noExternal: [
    /^@clash\/shared-(?:layout|runtime|types)(?:\/.*)?$/,
    /^@clash\/sdk$/,
  ],
  format: ["esm"],
  shims: true,
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  target: "node24",
  tsconfig: "tsconfig.dev.json",
  sourcemap: true,
  watch: [
    "src",
    "../../packages/shared-layout/src",
    "../../packages/shared-runtime/src",
    "../../packages/shared-types/src",
    "../../packages/clash-sdk/js/src",
  ],
  ignoreWatch: [
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.spec.ts",
    "**/*.spec.tsx",
  ],
  onSuccess: "electron .",
});
