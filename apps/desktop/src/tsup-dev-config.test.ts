import { describe, expect, it } from "vitest";

import devConfig from "../tsup.dev.config";

describe("desktop dev watcher", () => {
  it("does not restart Electron for test-only source changes", () => {
    if (typeof devConfig === "function") {
      throw new Error("Expected a static Desktop tsup configuration.");
    }
    const config = Array.isArray(devConfig) ? devConfig[0] : devConfig;

    expect(config?.ignoreWatch).toEqual(
      expect.arrayContaining([
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.spec.ts",
        "**/*.spec.tsx",
      ]),
    );
  });
});
