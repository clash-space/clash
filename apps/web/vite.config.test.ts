import { afterEach, beforeEach, describe, expect, it } from "vitest";

import viteConfig, {
  DEV_SOURCE_ALIASES,
  DEV_WATCH_IGNORES,
} from "./vite.config";

const originalDisableCloudflare = process.env.CLASH_WEB_E2E_NO_CLOUDFLARE;
const originalFreezeSource = process.env.CLASH_WEB_E2E_FREEZE_SOURCE;

beforeEach(() => {
  process.env.CLASH_WEB_E2E_NO_CLOUDFLARE = "1";
  delete process.env.CLASH_WEB_E2E_FREEZE_SOURCE;
});

afterEach(() => {
  if (originalDisableCloudflare === undefined) {
    delete process.env.CLASH_WEB_E2E_NO_CLOUDFLARE;
  } else {
    process.env.CLASH_WEB_E2E_NO_CLOUDFLARE = originalDisableCloudflare;
  }
  if (originalFreezeSource === undefined) {
    delete process.env.CLASH_WEB_E2E_FREEZE_SOURCE;
  } else {
    process.env.CLASH_WEB_E2E_FREEZE_SOURCE = originalFreezeSource;
  }
});

describe("Vite workspace source routing", () => {
  it("serves shared packages from source and ignores generated package output", async () => {
    expect(DEV_SOURCE_ALIASES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          find: /^@clash\/asset-sdk$/,
          replacement: expect.stringMatching(
            /\/packages\/asset-sdk\/src\/index\.ts$/,
          ),
        }),
        expect.objectContaining({
          find: /^@clash\/gui\/(.+)$/,
          replacement: expect.stringMatching(/\/packages\/gui\/src\/\$1$/),
        }),
        expect.objectContaining({
          find: /^@clash\/shared-types$/,
          replacement: expect.stringMatching(
            /\/packages\/shared-types\/src\/index\.ts$/,
          ),
        }),
        expect.objectContaining({
          find: /^@clash\/shared-runtime$/,
          replacement: expect.stringMatching(
            /\/packages\/shared-runtime\/src\/browser\.ts$/,
          ),
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
    expect(resolved.server?.hmr).not.toBe(false);
    expect(resolved.server?.port).toBe(3000);
    expect(resolved.preview?.port).toBe(3000);
  });

  it("loads workspace source without watching or hot-reloading it for a frozen E2E run", async () => {
    process.env.CLASH_WEB_E2E_FREEZE_SOURCE = "1";
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
    expect(resolved.server?.watch).toBeNull();
    expect(resolved.server?.hmr).toBe(false);
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
