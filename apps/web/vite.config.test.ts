import { afterEach, beforeEach, describe, expect, it } from "vitest";

import viteConfig, { DEV_SOURCE_ALIASES, DEV_WATCH_IGNORES } from "./vite.config";

const originalDisableCloudflare = process.env.CLASH_WEB_E2E_NO_CLOUDFLARE;

beforeEach(() => {
  process.env.CLASH_WEB_E2E_NO_CLOUDFLARE = "1";
});

afterEach(() => {
  if (originalDisableCloudflare === undefined) {
    delete process.env.CLASH_WEB_E2E_NO_CLOUDFLARE;
  } else {
    process.env.CLASH_WEB_E2E_NO_CLOUDFLARE = originalDisableCloudflare;
  }
});

describe("Vite workspace source routing", () => {
  it("serves shared packages from source and ignores generated package output", async () => {
    expect(DEV_SOURCE_ALIASES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          find: /^@clash\/shared-types$/,
          replacement: expect.stringMatching(/\/packages\/shared-types\/src\/index\.ts$/),
        }),
        expect.objectContaining({
          find: /^@clash\/shared-runtime$/,
          replacement: expect.stringMatching(/\/packages\/shared-runtime\/src\/index\.ts$/),
        }),
      ]),
    );
    expect(DEV_WATCH_IGNORES).toEqual(
      expect.arrayContaining(["**/dist/**", "**/release/**", "**/.tmp/**"]),
    );

    if (typeof viteConfig !== "function") {
      throw new Error("Expected Vite config to be a function.");
    }

    const resolved = await viteConfig({
      command: "serve",
      mode: "development",
      isPreview: false,
      isSsrBuild: false,
    });

    expect(resolved.resolve?.alias).toBe(DEV_SOURCE_ALIASES);
    expect(resolved.server?.watch?.ignored).toBe(DEV_WATCH_IGNORES);
  });

  it("keeps production builds on package exports", async () => {
    if (typeof viteConfig !== "function") {
      throw new Error("Expected Vite config to be a function.");
    }

    const resolved = await viteConfig({
      command: "build",
      mode: "production",
      isPreview: false,
      isSsrBuild: false,
    });

    expect(resolved.resolve?.alias).toBeUndefined();
  });
});
