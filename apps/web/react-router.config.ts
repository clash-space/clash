import type { Config } from "@react-router/dev/config";

// SPA mode: UI routes use clientLoader + fetch to /api/* (handled in worker
// entry, not as RR7 resource routes — SPA mode forbids server loaders).
// buildDirectory must match @cloudflare/vite-plugin's outDir ("dist") so the
// RR7 plugin can find its manifest after client build.
export default {
  ssr: false,
  buildDirectory: "dist",
} satisfies Config;
