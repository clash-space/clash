import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

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
  // itself is bundled by wrangler from workers/app.ts on deploy — the
  // @cloudflare/vite-plugin is intentionally absent because:
  //   (a) it doesn't support SPA mode with React Router v7 (only SSR)
  //   (b) it conflicts with Vite 8 + Rolldown (issue cloudflare/workers-sdk#12497)
  // For dev, run `wrangler dev` in apps/api-cf separately — the worker
  // talks to it via API_CF_URL env var when the API_CF service binding
  // isn't available (see workers/app.ts).
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
  },
  preview: {
    port: 3000,
  },
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
      "isbot",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-dev-runtime",
      "react/jsx-runtime",
    ],
  },
  environments: {
    server: {
      optimizeDeps: {
        exclude: ["loro-crdt"],
        include: [
          "isbot",
          "react-dom/server",
          "react/jsx-dev-runtime",
          "react/jsx-runtime",
          "react",
          "react-router",
          "framer-motion",
          "@phosphor-icons/react",
        ],
      },
    },
  },
});
