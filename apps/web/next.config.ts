import type { NextConfig } from 'next';
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Initialize Cloudflare bindings (including D1) for local development
// persist to root .wrangler/state so all services share the same D1
// --persist-to doesn't add /v3, but getPlatformProxy does by default.
// To share D1 with wrangler dev --persist-to ../../.wrangler/state, add /v3 manually.
initOpenNextCloudflareForDev({ persist: { path: "../../.wrangler/state/v3" } });

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/**': ['node_modules/next/dist/**'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
      allowedOrigins: ['localhost:3000', 'localhost:3001', '127.0.0.1:3000', '127.0.0.1:3001'],
    },
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: ['@master-clash/remotion-ui', '@master-clash/remotion-core', '@master-clash/remotion-components', '@clash/shared-layout'],
  // Cloudflare Workers/Pages compatibility
  images: {
    unoptimized: true, // Cloudflare uses their own image optimization
  },
  // No rewrites needed — Gateway handles all routing to api-cf.
  // Next.js only serves pages and server actions.
  // Prevent Turbopack/webpack from watching .wrangler (D1 sqlite writes) and dist folders
  serverExternalPackages: [],
  webpack(config) {
    config.watchOptions = {
      ...(config.watchOptions || {}),
      ignored: [
        '**/node_modules/**',
        '**/.wrangler/**',
        '**/.git/**',
        '**/dist/**',
      ],
    };
    config.experiments = {
      ...(config.experiments || {}),
      asyncWebAssembly: true,
    };

    config.module.rules.push({
      test: /\.wasm$/,
      type: 'webassembly/async',
    });

    return config;
  },
};

export default nextConfig;
