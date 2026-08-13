import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import wasm from "vite-plugin-wasm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const persistStatePath = process.env.CLASH_WEB_E2E_PERSIST_STATE?.trim()
  ? resolve(process.env.CLASH_WEB_E2E_PERSIST_STATE)
  : resolve(repoRoot, ".wrangler/state");

// During development, load shared workspaces from source instead of their
// generated package exports. This preserves source HMR while allowing Vite to
// ignore dist writes produced by tests/builds without serving stale modules.
export const DEV_SOURCE_ALIASES = [
  {
    find: /^@clash\/asset-sdk$/,
    replacement: resolve(repoRoot, "packages/asset-sdk/src/index.ts"),
  },
  {
    find: /^@clash\/gui\/(.+)$/,
    replacement: resolve(repoRoot, "packages/gui/src/$1"),
  },
  {
    find: /^@clash\/gui$/,
    replacement: resolve(repoRoot, "packages/gui/src/index.ts"),
  },
  {
    find: /^@clash\/shared-layout$/,
    replacement: resolve(repoRoot, "packages/shared-layout/src/index.ts"),
  },
  {
    find: /^@clash\/shared-types$/,
    replacement: resolve(repoRoot, "packages/shared-types/src/index.ts"),
  },
  {
    find: /^@clash\/shared-types\/assets$/,
    replacement: resolve(repoRoot, "packages/shared-types/src/assets.ts"),
  },
  {
    find: /^@clash\/shared-types\/timeline-library$/,
    replacement: resolve(
      repoRoot,
      "packages/shared-types/src/timeline-library.ts",
    ),
  },
  {
    find: /^@clash\/shared-runtime$/,
    replacement: resolve(repoRoot, "packages/shared-runtime/src/browser.ts"),
  },
  {
    find: /^@clash\/shared-runtime\/local-paths$/,
    replacement: resolve(
      repoRoot,
      "packages/shared-runtime/src/local-paths.ts",
    ),
  },
];

export const DEV_WATCH_IGNORES = ["**/dist/**", "**/release/**", "**/.tmp/**"];

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
export default defineConfig(async ({ command, isPreview }) => {
  const cloudflarePlugins =
    command === "serve" &&
    !isPreview &&
    process.env.CLASH_WEB_E2E_NO_CLOUDFLARE !== "1"
      ? [
          (await import("@cloudflare/vite-plugin")).cloudflare({
            remoteBindings: false,
            // Share .wrangler/state with api-cf (whose dev script also uses
            // ../../.wrangler/state). Without this each worker gets its own
            // miniflare D1 -> Better Auth verification rows written by web
            // don't exist when api-cf reads them, breaking Google OAuth.
            persistState: { path: persistStatePath },
            auxiliaryWorkers: [{ configPath: "../api-cf/wrangler.toml" }],
          }),
        ]
      : [];

  return {
    plugins: [
      // command is 'serve' for `vite dev` and `vite preview`; `isPreview`
      // distinguishes static preview from the development server.
      // Skip plugin in build so deploys (which read wrangler.toml directly) get
      // a plain SPA bundle without the plugin's wrangler.json redirect.
      ...cloudflarePlugins,
      tailwindcss(),
      // wasm support for loro-crdt; modern build target lets the runtime
      // handle top-level await natively (no vite-plugin-top-level-await
      // needed, which had esbuild version-skew issues across workspaces).
      wasm(),
      tsconfigPaths(),
    ],
    build: {
      outDir: "dist/client",
      emptyOutDir: true,
      assetsDir: "_app",
      // Workers/CF Pages run a modern V8 — no need to transpile destructuring
      // etc., and skipping the transform avoids esbuild version-skew issues
      // hit by vite-plugin-top-level-await on the WASM init code.
      target: "esnext",
      rollupOptions: {
        output: {
          // Force @phosphor-icons/react into its own chunk. Default chunk
          // splitting picks the icon defs into whichever chunk first uses
          // them and emits `let X; X = forwardRef(...)` patterns that read
          // as `undefined` from cross-chunk named imports → React #130.
          // Keeping the whole package in one chunk preserves top-level
          // const exports so cross-chunk imports resolve correctly.
          manualChunks(id: string) {
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
      alias: command === "serve" && !isPreview ? DEV_SOURCE_ALIASES : undefined,
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
      port: 3000,
      host: "0.0.0.0",
      // Vite restricts dev fs to cwd by default; in our pnpm monorepo,
      // workspace packages (packages/web-ui, etc.) live above apps/web/.
      // Without this, dynamic imports of those files 403 in dev.
      fs: { allow: [repoRoot] },
      // Tests and package builds rewrite workspace dist files. They are not
      // runtime inputs in dev (the aliases above point at source), so watching
      // them only causes expensive full-page reloads and lost editor state.
      watch: { ignored: DEV_WATCH_IGNORES },
    },
    preview: {
      port: 3000,
    },
    optimizeDeps: {
      // loro-crdt ships a .wasm alongside JS — exclude from esbuild prebundle so
      // vite-plugin-wasm handles it at request time.
      exclude: ["loro-crdt"],
      include: ["react-dom/client", "react/jsx-runtime"],
    },
  };
});
