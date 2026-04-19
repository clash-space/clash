import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

// Pull D1 migrations from the web app (the canonical schema location).
const migrationsPath = path.resolve(__dirname, "../web/drizzle");

export default defineConfig(async () => {
  const migrations = await readD1Migrations(migrationsPath);

  return {
    plugins: [
      cloudflareTest({
        singleWorker: true,
        // Workflows require shared storage in pool-workers; tests must clean up themselves.
        isolatedStorage: false,
        main: "./src/integration/test-worker.ts",
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations as unknown } as Record<string, unknown>,
          // loro-crdt ships .wasm; load anything matching as a CompiledWasm module.
          modulesRules: [
            { type: "CompiledWasm", include: ["**/*.wasm"], fallthrough: true },
          ],
        },
        wrangler: { configPath: "./wrangler.toml" },
      }),
    ],
    test: {
      testTimeout: 60_000,
      include: ["src/**/*.integration.test.ts"],
      setupFiles: ["./test/integration-setup.ts"],
    },
    // Pool-workers known issue: WASM modules in node_modules don't resolve via Vite's
    // dev server without inlining. Force loro-crdt + its sibling brotli-wasm into the
    // pre-bundle so the .wasm side-files are emitted as proper module assets.
    ssr: {
      noExternal: ["loro-crdt", "brotli-wasm"],
    },
    optimizeDeps: {
      include: ["loro-crdt"],
    },
    assetsInclude: ["**/*.wasm"],
  };
});
