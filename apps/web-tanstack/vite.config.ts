import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  server: {
    // In local dev, the worker (and its API_CF service binding) isn't running,
    // so /api/* would 404. Proxy them to the deployed API at api.clash.video
    // so the SPA can talk to a real backend (Better Auth, billing, etc.) while
    // we hot-reload the frontend.
    //
    // To run fully local instead (api-cf-hosted via `wrangler dev`), point
    // these at http://127.0.0.1:8790.
    proxy: {
      "/api": {
        target: "https://api.clash.video",
        changeOrigin: true,
        secure: true,
        // log every proxied request to stdout so you can see Better Auth
        // hits land at the upstream
        configure: (proxy) => {
          proxy.on("proxyReq", (_proxyReq, req) => {
            console.log(`[proxy] ${req.method} ${req.url} → api.clash.video`);
          });
          proxy.on("proxyRes", (proxyRes, req) => {
            console.log(`[proxy] ${req.method} ${req.url} ← ${proxyRes.statusCode}`);
          });
          proxy.on("error", (err, req) => {
            console.error(`[proxy] ${req.method} ${req.url} ✗ ${err.message}`);
          });
        },
      },
    },
  },
});

export default config;
