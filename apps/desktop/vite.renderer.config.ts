import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, mergeConfig } from "vite";

const desktopRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(desktopRoot, "../..");
const webRoot = resolve(repoRoot, "apps/web");

export function resolveDesktopRendererCacheDir(root: string): string {
  return resolve(root, ".vite/cache/main_window");
}

// Electron owns this renderer. Do not load Cloudflare's worker environments
// while Forge serves it or while the Desktop release artifact is built.
process.env.CLASH_WEB_E2E_NO_CLOUDFLARE = "1";

function rendererPort(): number {
  const port = Number(process.env.CLASH_DESKTOP_RENDERER_PORT ?? 3001);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `Invalid CLASH_DESKTOP_RENDERER_PORT: ${process.env.CLASH_DESKTOP_RENDERER_PORT}`,
    );
  }
  return port;
}

export default defineConfig(async (env) => {
  const { default: webConfigExport } = await import("../web/vite.config");
  const webConfig =
    typeof webConfigExport === "function"
      ? await webConfigExport(env)
      : await webConfigExport;

  return mergeConfig(webConfig, {
    root: webRoot,
    // The Desktop renderer and standalone web dev have different entry and
    // alias graphs. Sharing apps/web/node_modules/.vite lets one supervisor
    // serve the other's optimized chunks after a restart.
    cacheDir: resolveDesktopRendererCacheDir(desktopRoot),
    build: {
      outDir: resolve(desktopRoot, ".vite/renderer/main_window"),
      rollupOptions: {
        input: resolve(webRoot, "index.html"),
      },
    },
    server: {
      host: "127.0.0.1",
      port: rendererPort(),
      // Keep this as the preferred port. Vite may select the next available
      // port, and Forge injects that resolved URL into the main process.
      strictPort: false,
    },
  });
});
