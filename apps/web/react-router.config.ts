import type { Config } from "@react-router/dev/config";

// SPA mode: routes use clientLoader + fetch to /api/*. The worker entry
// at workers/app.ts handles API proxying + auth; for non-API paths it
// falls through to the ASSETS binding which serves the SPA shell.
// We bypass @cloudflare/vite-plugin (which doesn't support SPA mode with
// React Router v7) — `vite build` produces dist/client and wrangler
// bundles workers/app.ts directly.
export default {
  ssr: false,
  buildDirectory: "dist",
} satisfies Config;
