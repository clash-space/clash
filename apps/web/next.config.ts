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
  async rewrites() {
    // All backend routes now go through api-cf (merged service)
    const apiCfUrl = process.env.API_CF_URL || 'http://127.0.0.1:8789';

    return [
      {
        source: '/api/describe',
        destination: `${apiCfUrl}/api/describe`,
      },
      {
        source: '/api/tasks/:path*',
        destination: `${apiCfUrl}/api/tasks/:path*`,
      },
      {
        source: '/assets/:path*',
        destination: `${apiCfUrl}/assets/:path*`,
      },
      {
        source: '/thumbnails/:path*',
        destination: `${apiCfUrl}/thumbnails/:path*`,
      },
    ];
  },
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
