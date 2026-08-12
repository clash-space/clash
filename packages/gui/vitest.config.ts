import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "test-support/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
