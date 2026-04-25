import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

export default defineConfig({
  plugins: [
    tailwindcss(),
    // wasm + top-level-await must come before reactRouter so their resolvers
    // handle `.wasm` imports in loro-crdt.
    wasm(),
    topLevelAwait(),
    reactRouter(),
    tsconfigPaths(),
  ],
  // SPA mode (react-router.config.ts: ssr:false). `vite build` produces
  // dist/client which the Worker serves via the ASSETS binding. Worker
  // itself is bundled by wrangler from workers/app.ts on deploy.
  //
  // We don't use @cloudflare/vite-plugin: it doesn't support SPA mode with
  // React Router v7 (cloudflare/workers-sdk#12497) and the project is SPA
  // by design. For dev with workspace deps below the cwd, see server.fs.allow.

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
    port: 3000,
    host: "0.0.0.0",
    // Vite restricts dev fs to cwd by default; in our pnpm monorepo,
    // workspace packages (packages/web-ui, etc.) live above apps/web/.
    // Without this, dynamic imports of those files 403 in dev.
    fs: { allow: [repoRoot] },
  },
  preview: {
    port: 3000,
  },
  // SPA mode still runs a single SSR pass at build time to render the
  // static index.html shell. Workspace packages must be bundled into that
  // SSR pass (not treated as external imports) so vite-plugin-wasm,
  // top-level-await, etc. apply consistently — otherwise the SSR render
  // can produce a broken shell that breaks hydration with React #130.
  ssr: {
    noExternal: [
      "@master-clash/remotion-ui",
      "@master-clash/remotion-components",
      "@master-clash/remotion-core",
      "@clash/shared-layout",
      "@clash/shared-types",
      "@clash/web-ui",
    ],
  },
  optimizeDeps: {
    // loro-crdt ships a .wasm alongside JS — exclude from esbuild prebundle so
    // vite-plugin-wasm handles it at request time.
    exclude: ["loro-crdt"],
    include: [
      "react-dom/client",
      "react/jsx-runtime",
    ],
  },
});
