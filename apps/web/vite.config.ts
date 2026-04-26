import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

// Pure Vite SPA. index.html is the entry; main.tsx mounts a
// createBrowserRouter-based React app. No SSR at any layer.
//
// `@cloudflare/vite-plugin` is enabled only in `vite dev` so workers/app.ts
// runs inside the same vite dev process and `env.API_CF` resolves to the
// auxiliary api-cf worker (same path as prod).
//
// `vite build` skips the plugin so it emits a plain SPA bundle without the
// plugin's wrangler.json redirect. The deploy step (`wrangler deploy` with
// the project's own wrangler.toml — or the wrapper wrangler.toml in
// clash-hosted/apps/web-hosted) bundles workers/app.ts itself.
export default defineConfig(({ command }) => ({
  plugins: [
    // command is 'serve' for `vite dev`, 'build' for `vite build`/`vite preview`.
    // Skip plugin in build so deploys (which read wrangler.toml directly) get
    // a plain SPA bundle without the plugin's wrangler.json redirect.
    ...(command === "serve"
      ? [
          cloudflare({
            remoteBindings: false,
            // Share .wrangler/state with api-cf (whose dev script also uses
            // ../../.wrangler/state). Without this each worker gets its own
            // miniflare D1 → Better Auth verification rows written by web
            // don't exist when api-cf reads them, breaking Google OAuth.
            persistState: { path: resolve(repoRoot, ".wrangler/state") },
            auxiliaryWorkers: [{ configPath: "../api-cf/wrangler.toml" }],
          }),
        ]
      : []),
    tailwindcss(),
    // wasm + top-level-await are required for loro-crdt's .wasm import.
    wasm(),
    topLevelAwait(),
    tsconfigPaths(),
  ],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    assetsDir: "_app",
    rollupOptions: {
      output: {
        // Force @phosphor-icons/react into its own chunk. Default chunk
        // splitting picks the icon defs into whichever chunk first uses
        // them and emits `let X; X = forwardRef(...)` patterns that read
        // as `undefined` from cross-chunk named imports → React #130.
        // Keeping the whole package in one chunk preserves top-level
        // const exports so cross-chunk imports resolve correctly.
        manualChunks(id) {
          if (id.includes("@phosphor-icons")) return "phosphor";
        },
      },
    },
  },
  // Force single copy of react / remotion so <Player> and <VideoComposition>
  // share the same React Context. pnpm's peer-dep-scoped store creates 4
  // remotion copies (one per react/react-dom peer combo) — useVideoConfig()
  // returns null otherwise.
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "remotion",
      "@remotion/player",
      "@remotion/media-utils",
      "@remotion/transitions",
    ],
  },
  server: {
    port: 3001,
    host: "0.0.0.0",
    // Vite restricts dev fs to cwd by default; in our pnpm monorepo,
    // workspace packages (packages/web-ui, etc.) live above apps/web/.
    // Without this, dynamic imports of those files 403 in dev.
    fs: { allow: [repoRoot] },
  },
  preview: {
    port: 3001,
  },
  optimizeDeps: {
    // loro-crdt ships a .wasm alongside JS — exclude from esbuild prebundle so
    // vite-plugin-wasm handles it at request time.
    exclude: ["loro-crdt"],
    include: ["react-dom/client", "react/jsx-runtime"],
  },
}));
