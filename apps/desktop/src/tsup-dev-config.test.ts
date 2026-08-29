import { describe, expect, it } from "vitest";

import devConfig from "../tsup.dev.config";
import vitestConfig from "../vitest.config";

describe("desktop dev watcher", () => {
  it("resolves workspace SDK source imports without prebuilt artifacts", () => {
    const aliases = Array.isArray(vitestConfig.resolve?.alias)
      ? vitestConfig.resolve.alias
      : [];

    expect(aliases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          replacement: expect.stringContaining("packages/action-sdk/src/$1.ts"),
        }),
        expect.objectContaining({
          replacement: expect.stringContaining("packages/asset-sdk/src/index.ts"),
        }),
      ]),
    );
  });

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
