import type { NextConfig } from 'next';
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Initialize Cloudflare bindings (including D1) for local development
initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/**': ['node_modules/next/dist/**'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
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
