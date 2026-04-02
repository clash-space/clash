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
    // All backend routes proxy through Next.js to api-cf.
    // Clients never need to know api-cf's port — everything is same-origin.
    const apiCfUrl = process.env.API_CF_URL || 'http://127.0.0.1:8789';

    return [
      // WebSocket routes (Loro CRDT sync + Agent chat)
      {
        source: '/sync/:path*',
        destination: `${apiCfUrl}/sync/:path*`,
      },
      {
        source: '/agents/:path*',
        destination: `${apiCfUrl}/agents/:path*`,
      },
      // REST API routes
      {
        source: '/api/describe',
        destination: `${apiCfUrl}/api/describe`,
      },
      {
        source: '/api/tasks/:path*',
        destination: `${apiCfUrl}/api/tasks/:path*`,
      },
      {
        source: '/api/v1/:path*',
        destination: `${apiCfUrl}/api/v1/:path*`,
      },
      // Asset routes
      {
        source: '/assets/:path*',
        destination: `${apiCfUrl}/assets/:path*`,
      },
      {
        source: '/thumbnails/:path*',
        destination: `${apiCfUrl}/thumbnails/:path*`,
      },
      {
        source: '/upload/:path*',
        destination: `${apiCfUrl}/upload/:path*`,
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
