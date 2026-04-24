import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [
    // CF plugin must share RR7's env name ("server") so build outputs land in
    // dist/server/ where RR7's build plugin looks for its manifest.
    //
    // auxiliaryWorkers wires api-cf into the same vite/workerd dev session so
    // the service binding `env.API_CF` resolves at dev time (wrangler's
    // cross-process service binding doesn't work with the Vite plugin).
    // Don't run api-cf via `pnpm dev` separately — Vite owns its workerd here.
    cloudflare({
      viteEnvironment: { name: "server" },
      auxiliaryWorkers: [
        { configPath: "../api-cf/wrangler.toml" },
      ],
    }),
    tailwindcss(),
    // wasm + top-level-await must come before reactRouter so their resolvers
    // handle `.wasm` imports in loro-crdt.
    wasm(),
    topLevelAwait(),
    reactRouter(),
    tsconfigPaths(),
  ],
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
