import { describe, expect, it } from 'vitest';

import { ExecutablePluginOutputSchema } from './executable-plugin.js';

describe('provider-authenticated results', () => {
  const base = {
    slot: 'media',
    kind: 'asset' as const,
    asset: {
      assetId: 'asset-1',
      kind: 'video' as const,
      uri: 'clash-asset://asset-1',
    },
  };

  it('rejects the legacy host-injected provider credential', () => {
    expect(ExecutablePluginOutputSchema.safeParse({
      ...base,
      asset: {
        ...base.asset,
        url: 'https://generativelanguage.googleapis.com/v1/files/abc:download',
        reach: 'public',
        credential: 'provider',
      },
    }).success).toBe(false);
  });

  it('accepts a URL the host may fetch without provider credentials', () => {
    const parsed = ExecutablePluginOutputSchema.parse({
      ...base,
      asset: { ...base.asset, url: 'https://cdn.example/out.mp4', reach: 'public' },
    });
    expect(parsed.kind === 'asset' && parsed.asset.url).toBe('https://cdn.example/out.mp4');
  });
});
