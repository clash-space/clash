import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /**
     * Only hand-authored sources.
     *
     * Without an explicit include, a compiled copy of a test under a build output is collected and
     * run alongside the original, so the same assertions execute twice and a stale build can keep
     * contributing a pass after the source stopped agreeing with it.
     */
    include: ["src/**/*.test.ts"],
  },
});
