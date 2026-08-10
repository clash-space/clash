import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    /**
     * Only hand-authored sources.
     *
     * vitest's default excludes cover `dist` but not `.next`, which is where this app builds, so a
     * compiled chunk that happens to match `*.test.*` is collected and run. A planted file under
     * `.next/server/chunks/` executed and failed the suite, which means a stale build could just as
     * easily contribute a passing test nobody wrote.
     *
     * Tests live beside the code in `app/` and at the root, not under `src/`.
     */
    include: [
      "*.test.{ts,tsx}",
      "app/**/*.test.{ts,tsx}",
      "lib/**/*.test.{ts,tsx}",
    ],
  },
});
