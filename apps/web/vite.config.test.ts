import { afterEach, beforeEach, describe, expect, it } from "vitest";

import viteConfig, {
  DEV_SOURCE_ALIASES,
  DEV_WATCH_IGNORES,
} from "./vite.config";

const originalDisableCloudflare = process.env.CLASH_WEB_E2E_NO_CLOUDFLARE;

function collectPluginNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectPluginNames);
  if (!value || typeof value !== "object" || !("name" in value)) return [];

  const name = (value as { name?: unknown }).name;
  return typeof name === "string" ? [name] : [];
}

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
  it(
    "loads the dev copilot preview without unresolved workspace modules",
    async () => {
      const route = await import("./app/routes/__codex-copilot-preview");

      expect(route.default).toEqual(expect.any(Function));
    },
    20_000,
  );

  it("keeps React component state across source updates with Fast Refresh", async () => {
    if (typeof viteConfig !== "function") {
      throw new Error("Expected Vite config to be a function.");
    }

    const resolved = await viteConfig({
      command: "serve",
      mode: "development",
      isPreview: false,
      isSsrBuild: false,
    });
    const pluginNames = collectPluginNames(resolved.plugins);

    expect(pluginNames).toEqual(
      expect.arrayContaining(["vite:react-babel", "vite:react-refresh"]),
    );
  });

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
    expect(resolved.server?.port).toBe(3000);
    expect(resolved.preview?.port).toBe(3000);
  });

  it("excludes zod and zod-to-json-schema from dev prebundling", async () => {
    if (typeof viteConfig !== "function") {
      throw new Error("Expected Vite config to be a function.");
    }

    const resolved = await viteConfig({
      command: "serve",
      mode: "development",
      isPreview: false,
      isSsrBuild: false,
    });

    // Source aliases pull shared-types (zod v3 + zod-to-json-schema) into the
    // same module graph as apps/web + api-cf (zod v4). Prebundling would merge
    // the two majors into one optimized copy, breaking the Timeline DSL JSON
    // Schema conversion ("missing nested items").
    expect(resolved.optimizeDeps?.exclude).toEqual(
      expect.arrayContaining(["loro-crdt", "zod", "zod-to-json-schema"]),
    );
  });

  it("excludes the same deps for the clash_api worker environment", async () => {
    if (typeof viteConfig !== "function") {
      throw new Error("Expected Vite config to be a function.");
    }

    const resolved = await viteConfig({
      command: "serve",
      mode: "development",
      isPreview: false,
      isSsrBuild: false,
    });

    // The Cloudflare plugin creates a `clash_api` environment for the
    // auxiliary api-cf worker. Environment optimizers do not inherit the
    // top-level optimizeDeps.exclude, so the worker graph must repeat it.
    expect(resolved.environments?.clash_api?.optimizeDeps?.exclude).toEqual(
      expect.arrayContaining(["loro-crdt", "zod", "zod-to-json-schema"]),
    );
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
